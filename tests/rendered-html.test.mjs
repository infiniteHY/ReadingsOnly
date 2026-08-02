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
  assert.doesNotMatch(client, /codex-preview|Building your site|react-loading-skeleton/);
});

test("Cloudflare build, D1 migration, and social asset are present", async () => {
  const [hosting, migration, route] = await Promise.all([
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0000_fixed_betty_ross.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/api/grouping/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(hosting, /"d1": "DB"/);
  assert.match(migration, /CREATE TABLE `groups`/);
  assert.match(migration, /CREATE TABLE `group_members`/);
  assert.match(route, /historyRows/);
  assert.match(route, /saveRound/);
  await access(new URL("../dist/server/index.js", import.meta.url));
  await access(new URL("../public/og.png", import.meta.url));
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
});
