import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import * as allocation from "../lib/triple-allocation.mjs";
import * as legacy from "../../src/coordinator.mjs";

async function loadTs(path, dependencies = {}) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const record = { exports: {} };
  vm.runInNewContext(output, {
    module: record, exports: record.exports, Response,
    require(id) {
      if (!(id in dependencies)) throw new Error(`Unexpected dependency: ${id}`);
      return dependencies[id];
    },
  });
  return record.exports;
}
const grouping = await loadTs("../lib/grouping.ts", {
  "./triple-allocation.mjs": allocation,
  "./selection-schema": {
    SELECTION_CHOICE_FIELDS: ["选书1", "选书2", "选书3"],
    SELECTION_GROUP_FIELDS: ["选书1组号", "选书2组号", "选书3组号"],
    SELECTION_STATUS_FIELD: "有效状态",
  },
});
const emptyHistory = () => ({ counts: new Map(), lastPairs: new Set(), lastRound: "", tripleCounts: new Map() });
function selections(bookMembers) {
  const members = new Map();
  for (const [book, keys] of Object.entries(bookMembers)) for (const key of keys) {
    const item = members.get(key) ?? { key, name: key, row: { recordId: key }, choiceSlots: [] };
    item.choiceSlots.push({ book, choiceIndex: item.choiceSlots.length });
    members.set(key, item);
  }
  return [...members.values()];
}
for (const [name, implementation] of [["web", grouping], ["CLI", legacy]]) {
  test(`${name}: global allocation can reassign earlier books to avoid duplicate triples`, () => {
    const effective = selections({ A: ["a", "b", "c", "d", "e"], B: ["a", "b", "f"] });
    const result = implementation.makeGrouping(effective, emptyHistory(), "fixed");
    assert.equal(allocation.tripleWarnings(result.exportRows).length, 0);
    assert.deepEqual(new Set(result.exportRows.find((r) => r.book === "A" && r.members.length === 3).members), new Set(["c", "d", "e"]));
    assert.equal(result.assignments.size, 6);
    for (const item of effective) for (const slot of item.choiceSlots) assert.ok(result.assignments.get(item.key)[`选书${slot.choiceIndex + 1}组号`]);
    assert.equal(JSON.stringify(implementation.makeGrouping([...effective].reverse(), emptyHistory(), "fixed").exportRows), JSON.stringify(result.exportRows));
  });
  test(`${name}: historical triple members are avoided before pairing costs`, () => {
    const history = emptyHistory();
    history.tripleCounts = new Map([["a", 1], ["b", 2]]);
    history.counts = new Map([["c\u0000d", 1000], ["c\u0000e", 1000], ["d\u0000e", 1000]]);
    const result = implementation.makeGrouping(selections({ A: ["a", "b", "c", "d", "e"] }), history, "fixed");
    assert.deepEqual(new Set(result.exportRows.find((r) => r.members.length === 3).members), new Set(["c", "d", "e"]));
  });
  test(`${name}: unavoidable duplicate triples retain all choices and produce warnings`, () => {
    const result = implementation.makeGrouping(selections({ A: ["a", "b", "c"], B: ["a", "b", "c"] }), emptyHistory(), "fixed");
    assert.equal(result.exportRows.length, 2);
    assert.equal(allocation.tripleWarnings(result.exportRows).length, 3);
    assert.equal(result.exportRows.flatMap((r) => r.members).length, 6);
  });
}

test("triple allocation matches exhaustive optimum across overlapping odd books", () => {
  let state = 42;
  const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const choose3 = (keys) => keys.flatMap((a, i) => keys.slice(i + 1).flatMap((b, j) => keys.slice(i + j + 2).map((c) => [a, b, c])));
  const cost = (groups, history) => {
    const counts = new Map();
    for (const group of groups) for (const key of group) counts.set(key, (counts.get(key) ?? 0) + 1);
    return [...counts].reduce((sum, [key, n]) => [sum[0] + n * (n - 1) / 2, sum[1] + (history.get(key) > 0 ? n : 0), sum[2] + n * history.get(key)], [0, 0, 0]);
  };
  const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const keys = [..."abcdefg"];
    const books = new Map(["A", "B", "C"].map((book) => [book, { participants: keys.map((key) => ({ key, rank: random() })).sort((a, b) => a.rank - b.rank).slice(0, random() > 0.3 ? 5 : 3) }]));
    const history = new Map(keys.map((key) => [key, Math.floor(random() * 4)]));
    const choices = [...books.values()].map((entry) => choose3(entry.participants.map((p) => p.key)));
    const possible = choices[0].flatMap((a) => choices[1].flatMap((b) => choices[2].map((c) => cost([a, b, c], history)))).sort(compare);
    const actual = allocation.allocateTripleSeats(books, history, String(iteration));
    assert.deepEqual(cost([...actual.values()], history), possible[0]);
  }
});

test("history counts each actual triple once and uses chronological round order", () => {
  const rows = ["a", "b", "c", "a"].map((key) => ({ round: "2026-07", groupId: "1", memberKey: key, createdAt: "2026-10-01" }));
  rows.push(...["a", "b"].map((key) => ({ round: "2026-08", groupId: "1", memberKey: key, createdAt: "2026-08-01" })));
  const history = grouping.historyFromRows(rows);
  assert.equal(history.lastRound, "2026-08");
  assert.deepEqual(Array.from(history.tripleCounts, ([key, count]) => [key, count]), [["a", 1], ["b", 1], ["c", 1]]);
  assert.equal(history.counts.get("a\u0000b"), 2);
  const legacyRows = rows.map((row) => ({ "期次": row.round, "姓名/昵称": row.memberKey, "选书1": "A", "选书1组号": row.groupId, "有效状态": "有效" }));
  legacyRows.push({ "期次": "2026-07", "姓名/昵称": "invalid", "选书1": "A", "选书1组号": "1", "有效状态": "已替代" });
  legacyRows.push(...["x", "y", "z"].map((key) => ({ "期次": "2026-10", "姓名/昵称": key, "选书1": "A", "选书1组号": "1" })));
  assert.deepEqual([...legacy.buildPairHistory(legacyRows, "2026-09").tripleCounts], [["a", 1], ["b", 1], ["c", 1]]);
});

test("CSV backup includes edited groups, all members, Unicode and quoted titles", async () => {
  const { groupsCsv } = await loadTs("../lib/group-export.ts");
  const csv = groupsCsv("2026-08", [{ book: '书,"一"', group: "7", members: ["甲", "乙", "丙", "丁"] }, { book: "笔记", group: "0", members: ["戊"] }]);
  assert.ok(csv.startsWith("\ufeff"));
  assert.match(csv, /成员4/);
  assert.match(csv, /"书,""一""",7,甲,乙,丙,丁/);
  assert.match(csv, /笔记,0,戊/);
});

async function routeFixture({ failSave = false, failFeishu = false, failHistory = false, body = {} } = {}) {
  const calls = [];
  const saved = [{ book: "A", group: "7", status: "正常", members: ["a", "b"].map((key) => ({ key, name: key })) }];
  const route = await loadTs("../app/api/grouping/route.ts", {
    "../../../lib/auth": { isAdminRequest: async () => true },
    "../../../lib/triple-allocation.mjs": allocation,
    "../../../lib/grouping": grouping,
    "../../../lib/database": {
      currentRoundGroups: async () => saved, historyRows: async () => [], getRoundHistory: async () => { if (failHistory) throw new Error("history unavailable"); return []; },
      saveRound: async (input) => { calls.push(["save", input]); if (failSave) throw new Error("disk failed"); },
    },
    "../../../lib/feishu": {
      loadFeishuData: async () => ({ selectionTableId: "table", members: ["a", "b"].map((key) => ({ "姓名/昵称": key, "是否在籍": true })), selections: ["a", "b"].map((key) => ({ recordId: key, "姓名/昵称": key, "选书3": "A", "期次": "2026-08" })) }),
      updateSelectionRecords: async (table, patches) => { calls.push(["feishu", patches]); if (failFeishu) throw new Error("remote failed"); },
    },
  });
  const response = await route.POST(new Request("http://localhost/api/grouping", { method: "POST", body: JSON.stringify({ round: "2026-08", apply: true, ...body }) }));
  return { calls, response, payload: await response.json() };
}

test("writeback saves identical restored assignments locally before Feishu even without client edits", async () => {
  const { calls, payload } = await routeFixture();
  assert.deepEqual(calls.map(([kind]) => kind), ["save", "feishu"]);
  assert.equal(calls[0][1].groups[0].group, "7");
  assert.equal(calls[1][1][0].fields["选书3组号"], "7");
  assert.equal(payload.data.stored, true);
  assert.equal(payload.data.applied, true);
});

test("local save failure prevents remote writes; remote failure reports retained local copy", async () => {
  const localFailure = await routeFixture({ failSave: true });
  assert.deepEqual(localFailure.calls.map(([kind]) => kind), ["save"]);
  assert.equal(localFailure.payload.ok, false);
  const remoteFailure = await routeFixture({ failFeishu: true });
  assert.equal(remoteFailure.response.status, 502);
  assert.equal(remoteFailure.payload.stored, true);
  assert.match(remoteFailure.payload.error, /已保存.*飞书写回未完成/);
});

async function cliFixture({ failSave = false, failFeishu = false } = {}) {
  const files = new Map();
  const writes = [];
  const reads = [];
  let serial = 0;
  const service = await loadTs("../../src/lark-round-service.mjs", {
    "node:fs": {
      mkdirSync() {},
      writeFileSync(path, content) {
        if (failSave) throw new Error("local disk full");
        files.set(path, content);
      },
    },
    "node:crypto": { randomUUID: () => String(++serial) },
    "node:path": { resolve: (...parts) => parts.join("/") },
    "../web/lib/triple-allocation.mjs": allocation,
    "./coordinator.mjs": legacy,
    "node:child_process": {
      spawnSync(command, args) {
        assert.equal(command, "lark-cli");
        let result;
        if (args[1] === "+table-list") result = { data: { tables: [
          { id: "current", name: "选书汇总｜2026-08" },
          { id: "past", name: "选书汇总｜2026-07" },
          { id: "future", name: "选书汇总｜2026-09" },
        ] } };
        else if (args[1] === "+record-list") {
          const id = args[args.indexOf("--table-id") + 1];
          reads.push(id);
          const rows = id === "members" ? [..."abcde"].map((key) => ({ "姓名/昵称": key, "校验码": "1111", "是否在籍": true }))
            : id === "current" ? [..."abcde"].map((key) => ({ recordId: key, "姓名/昵称": key, "校验码": "1111", "选书3": "A" }))
            : [..."abx"].map((key) => ({ "姓名/昵称": key, "选书1": "旧书", "选书1组号": "1", "有效状态": "有效" }));
          result = { data: { data: rows } };
        } else if (args[1] === "+record-batch-update") {
          assert.equal(files.size, 2, "CSV and JSON must exist before remote write");
          if (failFeishu) return { status: 1, stderr: "remote failed" };
          writes.push(JSON.parse(args[args.indexOf("--json") + 1]));
          result = { ok: true };
        } else throw new Error(`Unexpected command: ${args}`);
        return { status: 0, stdout: JSON.stringify(result) };
      },
    },
  });
  return { service, files, writes, reads };
}

test("CLI reads past rounds, persists CSV and JSON before writes, and never overwrites applied backup with preview", async () => {
  const { service, files, writes, reads } = await cliFixture();
  const options = { round: "2026-08", memberTableId: "members", outputDir: "output" };
  const result = service.runRound({ ...options, apply: true });
  assert.ok(reads.includes("past"));
  assert.ok(!reads.includes("future"));
  assert.ok(writes.length);
  assert.equal(result.historyRound, "2026-07");
  assert.deepEqual(new Set(result.groups.find((group) => group.members.length === 3).members), new Set(["c", "d", "e"]));
  const snapshot = JSON.parse(files.get(result.snapshotPath));
  assert.equal(snapshot.applied, true);
  assert.equal(JSON.stringify(snapshot.groups), JSON.stringify(result.groups));
  assert.match(files.get(result.csvPath), /c|d|e/);
  const preview = service.runRound(options);
  assert.notEqual(preview.csvPath, result.csvPath);
  assert.equal(files.size, 4);
  assert.equal(JSON.parse(files.get(result.snapshotPath)).applied, true);
});

test("CLI preserves backup on Feishu failure and does not write remotely if disk save fails", async () => {
  const options = { round: "2026-08", memberTableId: "members", outputDir: "output", apply: true };
  const disk = await cliFixture({ failSave: true });
  assert.throws(() => disk.service.runRound(options), /local disk full/);
  assert.equal(disk.writes.length, 0);
  const remote = await cliFixture({ failFeishu: true });
  assert.throws(() => remote.service.runRound(options), /本地 CSV 和 JSON 已保存.*飞书写回未完成/);
  assert.equal(remote.files.size, 2);
  assert.equal(JSON.parse([...remote.files].find(([path]) => path.endsWith(".json"))[1]).applied, false);
});


test("history refresh failure keeps successful writeback response", async () => {
  const { calls, payload } = await routeFixture({ failHistory: true });
  assert.deepEqual(calls.map(([kind]) => kind), ["save", "feishu"]);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.applied, true);
  assert.equal(payload.data.stored, true);
  assert.match(payload.data.historyWarning, /已保存.*历史列表刷新失败/);
  assert.equal(payload.data.groups[0].group, "7");
});

test("regenerate previews new rules without overwriting saved groups; local-only save never writes Feishu", async () => {
  const preserved = await routeFixture({ body: { apply: false } });
  assert.equal(preserved.payload.data.groups[0].group, "7");
  const regenerated = await routeFixture({ body: { apply: false, regenerate: true } });
  assert.equal(regenerated.payload.data.groups[0].group, "1");
  assert.equal(regenerated.calls.length, 0);
  const localOnly = await routeFixture({ body: { writeFeishu: false } });
  assert.deepEqual(localOnly.calls.map(([kind]) => kind), ["save"]);
  assert.equal(localOnly.payload.data.applied, false);
  assert.equal(localOnly.payload.data.stored, true);
});
