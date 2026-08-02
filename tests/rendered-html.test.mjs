import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("coordinator page contains the complete primary workflow", async () => {
  const client = await readFile(new URL("../app/CoordinatorApp.tsx", import.meta.url), "utf8");
  assert.match(client, /把选书名单，变成/);
  assert.match(client, /预览结果/);
  assert.match(client, /确认并写回飞书/);
  assert.match(client, /数据库历史/);
  assert.match(client, /下载 CSV/);
  assert.match(client, /按期次归档/);
  assert.match(client, /推书汇总/);
  assert.match(client, /初始化.*本期/);
  assert.doesNotMatch(client, /codex-preview|Building your site|react-loading-skeleton/);
});

test("round-specific Feishu tables replace the fixed selection table", async () => {
  const [feishu, grouping, schema, route] = await Promise.all([
    readFile(new URL("../lib/feishu.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/grouping.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/selection-schema.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/round-tables/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(feishu, /选书汇总｜/);
  assert.match(feishu, /推书汇总｜/);
  assert.match(feishu, /ensureRoundResources/);
  assert.match(feishu, /await ensureFields\(table\.id, adminFields, fields\)/);
  assert.doesNotMatch(feishu, /method: "DELETE"/);
  assert.match(feishu, /"期次": round/);
  assert.doesNotMatch(feishu, /LARK_SELECTION_TABLE_ID/);
  assert.match(schema, /选书1组号/);
  assert.match(schema, /选书2组号/);
  assert.match(schema, /选书3组号/);
  assert.match(grouping, /SELECTION_GROUP_FIELDS/);
  assert.match(route, /isAdminRequest/);
  assert.match(route, /ensureRoundResources/);
});

test("Cloudflare build, D1 migration, and social asset are present", async () => {
  const [hosting, wrangler, migration, route] = await Promise.all([
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0000_fixed_betty_ross.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/api/grouping/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(hosting, /"project_id"/);
  assert.match(wrangler, /"binding": "DB"/);
  assert.match(wrangler, /"database_name": "reading-club-coordinator-db"/);
  assert.match(migration, /CREATE TABLE `groups`/);
  assert.match(migration, /CREATE TABLE `group_members`/);
  assert.match(route, /historyRows/);
  assert.match(route, /saveRound/);
  await access(new URL("../dist/server/index.js", import.meta.url));
  await access(new URL("../public/og.png", import.meta.url));
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
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
