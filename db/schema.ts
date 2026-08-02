import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const rounds = sqliteTable("rounds", {
  id: text("id").primaryKey(),
  activeCount: integer("active_count").notNull().default(0),
  submittedCount: integer("submitted_count").notNull().default(0),
  missingCount: integer("missing_count").notNull().default(0),
  groupCount: integer("group_count").notNull().default(0),
  appliedAt: text("applied_at").notNull(),
});

export const selections = sqliteTable("selections", {
  round: text("round").notNull(),
  memberKey: text("member_key").notNull(),
  memberName: text("member_name").notNull(),
  feishuRecordId: text("feishu_record_id"),
  choicesJson: text("choices_json").notNull(),
  submittedAt: integer("submitted_at").notNull().default(0),
}, (table) => [
  primaryKey({ columns: [table.round, table.memberKey] }),
  index("selections_round_idx").on(table.round),
]);

export const groups = sqliteTable("groups", {
  id: text("id").primaryKey(),
  round: text("round").notNull(),
  book: text("book").notNull(),
  groupNo: text("group_no").notNull(),
  status: text("status").notNull().default("正常"),
  createdAt: text("created_at").notNull(),
}, (table) => [index("groups_round_idx").on(table.round)]);

export const groupMembers = sqliteTable("group_members", {
  groupId: text("group_id").notNull(),
  memberKey: text("member_key").notNull(),
  memberName: text("member_name").notNull(),
}, (table) => [
  primaryKey({ columns: [table.groupId, table.memberKey] }),
  index("group_members_member_idx").on(table.memberKey),
]);
