import { env } from "cloudflare:workers";
import type { Evaluation } from "./grouping";

function database() {
  const bindings = env as unknown as { DB?: D1Database };
  if (!bindings.DB) throw new Error("Cloudflare D1 数据库尚未绑定");
  return bindings.DB;
}

export async function historyRows(excludeRound: string) {
  const result = await database().prepare(`
    SELECT g.round, g.id AS group_id, gm.member_key, g.created_at
    FROM groups g
    JOIN group_members gm ON gm.group_id = g.id
    WHERE g.round < ? AND g.status = '正常' AND g.group_no NOT IN ('0', '待协调')
    ORDER BY g.created_at ASC, g.id ASC
  `).bind(excludeRound).all<{ round: string; group_id: string; member_key: string; created_at: string }>();
  return result.results.map((row: { round: string; group_id: string; member_key: string; created_at: string }) => ({ round: row.round, groupId: row.group_id, memberKey: row.member_key, createdAt: row.created_at }));
}

export type StoredGroup = { book: string; group: string; status: string; members: { key: string; name: string }[] };

export async function currentRoundGroups(round: string): Promise<StoredGroup[] | null> {
  const db = database();
  const saved = await db.prepare("SELECT id FROM rounds WHERE id = ?").bind(round).first<{ id: string }>();
  if (!saved) return null;
  const rows = await db.prepare(`
    SELECT g.id AS group_id, g.book, g.group_no, g.status, gm.member_key, gm.member_name
    FROM groups g
    LEFT JOIN group_members gm ON gm.group_id = g.id
    WHERE g.round = ?
    ORDER BY g.book ASC,
      CASE WHEN g.group_no = '0' THEN 999998 WHEN g.group_no = '待协调' THEN 999999 ELSE CAST(g.group_no AS INTEGER) END ASC,
      g.id ASC, gm.member_name ASC
  `).bind(round).all<{ group_id: string; book: string; group_no: string; status: string; member_key: string | null; member_name: string | null }>();
  const groups = new Map<string, StoredGroup>();
  for (const row of rows.results) {
    const group = groups.get(row.group_id) ?? { book: row.book, group: row.group_no, status: row.status, members: [] };
    if (row.member_key && row.member_name) group.members.push({ key: row.member_key, name: row.member_name });
    groups.set(row.group_id, group);
  }
  return [...groups.values()];
}

function groupId(round: string, book: string, groupNo: string) {
  const source = `${round}\u0000${book.normalize("NFKC").toLocaleLowerCase("zh-CN")}\u0000${groupNo}`;
  let hash = 2166136261;
  for (const char of source) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return `grp_${hash.toString(16).padStart(8, "0")}`;
}

export async function saveRound(input: {
  round: string;
  stats: { active: number; submitted: number; missing: number; groups: number };
  effective: Evaluation[];
  groups: { book: string; group: string; members: string[]; memberKeys: string[] }[];
}) {
  const db = database();
  const now = new Date().toISOString();
  const statements = [
    db.prepare("DELETE FROM group_members WHERE group_id IN (SELECT id FROM groups WHERE round = ?)").bind(input.round),
    db.prepare("DELETE FROM groups WHERE round = ?").bind(input.round),
    db.prepare("DELETE FROM selections WHERE round = ?").bind(input.round),
    db.prepare(`INSERT INTO rounds (id, active_count, submitted_count, missing_count, group_count, applied_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET active_count=excluded.active_count, submitted_count=excluded.submitted_count,
      missing_count=excluded.missing_count, group_count=excluded.group_count, applied_at=excluded.applied_at`)
      .bind(input.round, input.stats.active, input.stats.submitted, input.stats.missing, input.stats.groups, now),
  ];
  for (const item of input.effective) {
    statements.push(db.prepare(`INSERT INTO selections
      (round, member_key, member_name, feishu_record_id, choices_json, submitted_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(input.round, item.key, item.name, item.row.recordId ?? null, JSON.stringify(item.choices), item.submittedAt));
  }
  for (const [groupIndex, group] of input.groups.entries()) {
    const id = groupId(input.round, group.book, `${group.group}:${groupIndex}:${group.memberKeys.join("\u0000")}`);
    statements.push(db.prepare("INSERT INTO groups (id, round, book, group_no, status, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(id, input.round, group.book, group.group, group.group === "0" ? "读书笔记组" : group.group === "待协调" ? "待协调" : "正常", now));
    group.members.forEach((name, index) => {
      statements.push(db.prepare("INSERT INTO group_members (group_id, member_key, member_name) VALUES (?, ?, ?)")
        .bind(id, group.memberKeys[index], name));
    });
  }
  await db.batch(statements);
}

export async function getRoundHistory() {
  const db = database();
  const rounds = await db.prepare(`
    SELECT id, active_count, submitted_count, missing_count, group_count, applied_at
    FROM rounds ORDER BY applied_at DESC LIMIT 12
  `).all<{ id: string; active_count: number; submitted_count: number; missing_count: number; group_count: number; applied_at: string }>();
  const roundIds = rounds.results.map((row) => row.id);
  if (!roundIds.length) return [];
  const placeholders = roundIds.map(() => "?").join(", ");
  const details = await db.prepare(`
    SELECT g.id AS group_id, g.round, g.book, g.group_no, g.status,
      gm.member_key, gm.member_name
    FROM groups g
    LEFT JOIN group_members gm ON gm.group_id = g.id
    WHERE g.round IN (${placeholders})
    ORDER BY g.round DESC, g.book ASC,
      CASE WHEN g.group_no = '待协调' THEN 999999 ELSE CAST(g.group_no AS INTEGER) END ASC,
      gm.member_name ASC
  `).bind(...roundIds).all<{
    group_id: string;
    round: string;
    book: string;
    group_no: string;
    status: string;
    member_key: string | null;
    member_name: string | null;
  }>();
  const detailsByRound = new Map<string, Map<string, {
    book: string;
    group: string;
    status: string;
    members: { key: string; name: string }[];
  }>>();
  for (const row of details.results) {
    const roundGroups = detailsByRound.get(row.round) ?? new Map();
    const group = roundGroups.get(row.group_id) ?? {
      book: row.book,
      group: row.group_no,
      status: row.status,
      members: [],
    };
    if (row.member_key && row.member_name) group.members.push({ key: row.member_key, name: row.member_name });
    roundGroups.set(row.group_id, group);
    detailsByRound.set(row.round, roundGroups);
  }
  return rounds.results.map((row: { id: string; active_count: number; submitted_count: number; missing_count: number; group_count: number; applied_at: string }) => ({
    round: row.id,
    active: row.active_count,
    submitted: row.submitted_count,
    missing: row.missing_count,
    groups: row.group_count,
    appliedAt: row.applied_at,
    groupDetails: [...(detailsByRound.get(row.id)?.values() ?? [])],
  }));
}
