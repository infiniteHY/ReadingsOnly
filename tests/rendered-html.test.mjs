import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

async function loadGroupingModule() {
  const source = await readFile(new URL("../lib/grouping.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const moduleRecord = { exports: {} };
  vm.runInNewContext(output, {
    module: moduleRecord,
    exports: moduleRecord.exports,
    require(id) {
      if (id === "./selection-schema") return {
        SELECTION_CHOICE_FIELDS: ["选书1", "选书2", "选书3"],
        SELECTION_GROUP_FIELDS: ["选书1组号", "选书2组号", "选书3组号"],
        SELECTION_STATUS_FIELD: "有效状态",
      };
      throw new Error(`Unexpected require: ${id}`);
    },
  });
  return moduleRecord.exports;
}

test("coordinator page contains the complete primary workflow", async () => {
  const client = await readFile(new URL("../app/CoordinatorApp.tsx", import.meta.url), "utf8");
  assert.match(client, /把选书名单，变成/);
  assert.match(client, /预览结果/);
  assert.match(client, /确认并写回飞书/);
  assert.match(client, /数据库历史/);
  assert.match(client, /下载 CSV/);
  assert.match(client, /按期次归档/);
  assert.match(client, /推书汇总/);
  assert.match(client, /本期书单/);
  assert.match(client, /导出图片卡片/);
  assert.match(client, /toDataURL\("image\/png"\)/);
  assert.match(client, /同步.*本期/);
  assert.doesNotMatch(client, /codex-preview|Building your site|react-loading-skeleton/);
});

test("round-specific Feishu tables replace the fixed selection table", async () => {
  const [feishu, grouping, schema, route, booksRoute] = await Promise.all([
    readFile(new URL("../lib/feishu.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/grouping.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/selection-schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/round-tables/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/round-books/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(feishu, /选书汇总｜/);
  assert.match(feishu, /推书汇总｜/);
  assert.match(feishu, /syncRoundResources/);
  assert.match(feishu, /请先在飞书中人工创建/);
  assert.match(feishu, /请人工补齐后重新同步/);
  assert.doesNotMatch(feishu, /校验码/);
  assert.doesNotMatch(feishu, /createTable|createField|ensureFields|createFormQuestions|configureForm|method: "DELETE"|question_ids/);
  assert.match(feishu, /"期次": round/);
  assert.doesNotMatch(feishu, /LARK_SELECTION_TABLE_ID/);
  assert.match(schema, /选书1组号/);
  assert.match(schema, /选书2组号/);
  assert.match(schema, /选书3组号/);
  assert.doesNotMatch(schema, /选书[456]/);
  assert.match(grouping, /SELECTION_GROUP_FIELDS/);
  assert.doesNotMatch(grouping, /校验码/);
  assert.match(route, /isAdminRequest/);
  assert.match(route, /syncRoundResources/);
  assert.match(feishu, /loadRoundBooks/);
  assert.match(feishu, /recommendationRequiredFields = \["书名", "推荐人", "推荐语", "入选"\]/);
  assert.match(feishu, /recommender: textValue\(row\["推荐人"\]\)/);
  assert.doesNotMatch(feishu, /推书人/);
  assert.match(feishu, /checkboxValue\(row\["入选"\]\)/);
  assert.match(booksRoute, /isAdminRequest/);
  assert.match(booksRoute, /loadRoundBooks/);
});

test("Cloudflare build, D1 migration, and social asset are present", async () => {
  const [hosting, wrangler, migration, route, database, client] = await Promise.all([
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0000_fixed_betty_ross.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/api/grouping/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/database.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/CoordinatorApp.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(hosting, /"project_id"/);
  assert.match(wrangler, /"binding": "DB"/);
  assert.match(wrangler, /"database_name": "reading-club-coordinator-db"/);
  assert.match(migration, /CREATE TABLE `groups`/);
  assert.match(migration, /CREATE TABLE `group_members`/);
  assert.match(route, /historyRows/);
  assert.match(route, /saveRound/);
  assert.match(database, /groupDetails/);
  assert.match(client, /查看分组/);
  assert.match(client, /历史分组明细/);
  await access(new URL("../dist/server/index.js", import.meta.url));
  await access(new URL("../public/og.png", import.meta.url));
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
});

test("grouping uses pairs and puts one odd remainder into the final group", async () => {
  const { makeGrouping } = await loadGroupingModule();
  const emptyHistory = { counts: new Map(), lastPairs: new Set(), lastRound: "" };
  const expectedSizes = new Map([
    [1, [1]],
    [2, [2]],
    [3, [3]],
    [4, [2, 2]],
    [5, [2, 3]],
    [6, [2, 2, 2]],
    [7, [2, 2, 3]],
  ]);
  for (const [count, expected] of expectedSizes) {
    const effective = Array.from({ length: count }, (_, index) => ({
      key: `member-${index}`,
      name: `成员${index}`,
      row: { recordId: `record-${index}` },
      choiceSlots: [{ book: "测试书", choiceIndex: 0 }],
    }));
    const sizes = [...makeGrouping(effective, emptyHistory, "2026-08").exportRows]
      .map((group) => group.members.length);
    assert.deepEqual(sizes, expected);
  }
});

test("greedy grouping avoids previously paired members when unseen partners exist", async () => {
  const { makeGrouping } = await loadGroupingModule();
  const effective = ["a", "b", "c", "d"].map((key) => ({
    key,
    name: key.toUpperCase(),
    row: { recordId: `record-${key}` },
    choiceSlots: [{ book: "测试书", choiceIndex: 0 }],
  }));
  const oldPairs = new Set(["a\u0000b", "c\u0000d"]);
  const history = {
    counts: new Map([...oldPairs].map((pair) => [pair, 1])),
    lastPairs: oldPairs,
    lastRound: "2026-07",
  };
  const result = makeGrouping(effective, history, "2026-08");
  for (const group of result.exportRows) {
    const pair = [...group.memberKeys].sort().join("\u0000");
    assert.equal(oldPairs.has(pair), false);
  }
});

test("single-admin login protects the workbench and server APIs", async () => {
  const [auth, page, grouping, login] = await Promise.all([
    readFile(new URL("../lib/auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/grouping/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/login/LoginForm.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(auth, /ADMIN_PASSWORD/);
  assert.match(auth, /ADMIN_SESSION_SECRET/);
  assert.match(auth, /HttpOnly; SameSite=Strict/);
  assert.match(page, /redirect\("\/login"\)/);
  assert.match(grouping, /isAdminRequest/);
  assert.match(login, /username: "admin"/);
  assert.doesNotMatch(auth, /ADMIN_PASSWORD\s*[:=]\s*["'][^"']+["']/);
});
