import { env } from "cloudflare:workers";
import { textValue, type RecordRow } from "./grouping";
import { SELECTION_CHOICE_FIELDS, SELECTION_GROUP_FIELDS, SELECTION_STATUS_FIELD } from "./selection-schema";

type AppEnv = {
  LARK_APP_ID?: string;
  LARK_APP_SECRET?: string;
  LARK_BASE_TOKEN?: string;
  LARK_MEMBER_TABLE_ID?: string;
};

type TableItem = { id: string; name: string };
type FormItem = { id: string; name: string };
type FieldItem = { id: string; name: string; type: string };

export type RoundTableResource = {
  tableId: string;
  tableName: string;
  formId: string | null;
  formName: string | null;
  recordCount: number;
};

export type RoundResources = {
  round: string;
  selection: RoundTableResource | null;
  recommendation: RoundTableResource | null;
};

export type RoundBook = {
  title: string;
  recommendation: string;
  recommender: string;
};

const SELECTION_PREFIX = "选书汇总｜";
const RECOMMENDATION_PREFIX = "推书汇总｜";

const selectionRequiredFields = [
  "姓名/昵称",
  ...SELECTION_CHOICE_FIELDS,
  SELECTION_STATUS_FIELD,
  ...SELECTION_GROUP_FIELDS,
];

const recommendationRequiredFields = ["书名", "推书人", "推荐语", "入选"];
const selectionWriteFields = [SELECTION_STATUS_FIELD, ...SELECTION_GROUP_FIELDS];

let tokenCache: { token: string; expiresAt: number } | null = null;

function config() {
  const values = env as unknown as AppEnv;
  const required = ["LARK_APP_ID", "LARK_APP_SECRET", "LARK_BASE_TOKEN", "LARK_MEMBER_TABLE_ID"] as const;
  const missing = required.filter((key) => !values[key]);
  if (missing.length) throw new Error(`部署尚未配置飞书连接：${missing.join("、")}`);
  return values as Required<AppEnv>;
}

export function validRound(round: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(round);
}

export function roundTableName(kind: "selection" | "recommendation", round: string) {
  return `${kind === "selection" ? SELECTION_PREFIX : RECOMMENDATION_PREFIX}${round}`;
}

async function tenantToken() {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 5 * 60_000) return tokenCache.token;
  const values = config();
  const response = await fetch("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ app_id: values.LARK_APP_ID, app_secret: values.LARK_APP_SECRET }),
  });
  const data = await response.json() as { code: number; msg: string; tenant_access_token?: string; expire?: number };
  if (!response.ok || data.code !== 0 || !data.tenant_access_token) throw new Error(`飞书授权失败：${data.msg || response.status}`);
  tokenCache = { token: data.tenant_access_token, expiresAt: Date.now() + (data.expire ?? 3600) * 1000 };
  return tokenCache.token;
}

async function request(path: string, init?: RequestInit, operation = "") {
  const token = await tenantToken();
  const response = await fetch(`https://open.feishu.cn${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
      ...(init?.headers ?? {}),
    },
  });
  const data = await response.json() as { code: number; msg: string; data?: Record<string, unknown> };
  if (response.ok && data.code === 0) return data.data ?? {};
  const prefix = operation ? `${operation}：` : "";
  const code = data.code ? `（code ${data.code}）` : "";
  throw new Error(`飞书接口失败：${prefix}${data.msg || response.status}${code}`);
}

function itemId(value: Record<string, unknown>) {
  return String(value.id ?? value.table_id ?? value.form_id ?? value.field_id ?? "");
}

async function listTables(): Promise<TableItem[]> {
  const values = config();
  const data = await request(`/open-apis/base/v3/bases/${values.LARK_BASE_TOKEN}/tables?offset=0&limit=100`);
  const items = (data.items ?? data.tables ?? []) as Record<string, unknown>[];
  return items.map((item) => ({ id: itemId(item), name: String(item.name ?? item.table_name ?? "") })).filter((item) => item.id && item.name);
}

async function listFields(tableId: string): Promise<FieldItem[]> {
  const values = config();
  const data = await request(`/open-apis/base/v3/bases/${values.LARK_BASE_TOKEN}/tables/${tableId}/fields?offset=0&limit=200`, undefined, "读取数据表字段");
  const items = (data.items ?? data.fields ?? []) as Record<string, unknown>[];
  return items.map((item) => ({ id: itemId(item), name: String(item.name ?? item.field_name ?? ""), type: String(item.type ?? "") })).filter((item) => item.id && item.name);
}

async function listForms(tableId: string): Promise<FormItem[]> {
  const values = config();
  const data = await request(`/open-apis/base/v3/bases/${values.LARK_BASE_TOKEN}/tables/${tableId}/forms?page_size=100`, undefined, "读取数据表表单");
  const items = (data.forms ?? data.items ?? []) as Record<string, unknown>[];
  return items.map((item) => ({ id: itemId(item), name: String(item.name ?? "") })).filter((item) => item.id && item.name);
}

async function listRecords(tableId: string): Promise<RecordRow[]> {
  const values = config();
  const rows: RecordRow[] = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({ page_size: "500" });
    if (pageToken) params.set("page_token", pageToken);
    const data = await request(`/open-apis/bitable/v1/apps/${values.LARK_BASE_TOKEN}/tables/${tableId}/records?${params}`);
    const items = (data.items ?? []) as { record_id?: string; fields?: Record<string, unknown> }[];
    rows.push(...items.map((item) => ({ recordId: item.record_id, ...(item.fields ?? {}) })));
    pageToken = data.has_more ? String(data.page_token ?? "") : "";
  } while (pageToken);
  return rows;
}

function requireRoundTable(tables: TableItem[], kind: "selection" | "recommendation", round: string) {
  const name = roundTableName(kind, round);
  const table = tables.find((item) => item.name === name);
  if (!table) throw new Error(`请先在飞书中人工创建“${name}”，再回到平台同步`);
  return table;
}

async function validateFields(table: TableItem, requiredNames: readonly string[]) {
  const fields = await listFields(table.id);
  const names = new Set(fields.map((field) => field.name));
  const missing = requiredNames.filter((name) => !names.has(name));
  if (missing.length) {
    throw new Error(`飞书数据表“${table.name}”缺少字段：${missing.join("、")}；请人工补齐后重新同步`);
  }
  return fields;
}

async function resourceFor(table: TableItem | undefined, formName: string): Promise<RoundTableResource | null> {
  if (!table) return null;
  const [forms, records] = await Promise.all([listForms(table.id), listRecords(table.id)]);
  const form = forms.find((item) => item.name === formName) ?? forms[0] ?? null;
  return {
    tableId: table.id,
    tableName: table.name,
    formId: form?.id ?? null,
    formName: form?.name ?? null,
    recordCount: records.length,
  };
}

async function resourcesFromTables(round: string, tables: TableItem[]): Promise<RoundResources> {
  const selectionTable = tables.find((item) => item.name === roundTableName("selection", round));
  const recommendationTable = tables.find((item) => item.name === roundTableName("recommendation", round));
  const [selection, recommendation] = await Promise.all([
    resourceFor(selectionTable, `${round} 选书表单`),
    resourceFor(recommendationTable, `${round} 荐书表单`),
  ]);
  return { round, selection, recommendation };
}

export async function getRoundResources(round: string): Promise<RoundResources> {
  if (!validRound(round)) throw new Error("期次格式应为 YYYY-MM，例如 2026-08");
  return resourcesFromTables(round, await listTables());
}

export async function syncRoundResources(round: string) {
  if (!validRound(round)) throw new Error("期次格式应为 YYYY-MM，例如 2026-08");
  const tables = await listTables();
  const selectionTable = requireRoundTable(tables, "selection", round);
  const recommendationTable = requireRoundTable(tables, "recommendation", round);
  await Promise.all([
    validateFields(selectionTable, selectionRequiredFields),
    validateFields(recommendationTable, recommendationRequiredFields),
  ]);
  return resourcesFromTables(round, tables);
}

export async function loadFeishuData(round: string) {
  if (!validRound(round)) throw new Error("期次格式应为 YYYY-MM，例如 2026-08");
  const values = config();
  const tables = await listTables();
  const selectionTable = requireRoundTable(tables, "selection", round);
  await validateFields(selectionTable, selectionRequiredFields);
  const [members, rawSelections] = await Promise.all([
    listRecords(values.LARK_MEMBER_TABLE_ID),
    listRecords(selectionTable.id),
  ]);
  const selections = rawSelections.map((row) => ({ ...row, "期次": round }));
  return { members, selections, selectionTableId: selectionTable.id };
}

function checkboxValue(value: unknown) {
  if (typeof value === "boolean") return value;
  return ["1", "true", "是", "yes", "y"].includes(textValue(value).toLocaleLowerCase("zh-CN"));
}

export async function loadRoundBooks(round: string) {
  if (!validRound(round)) throw new Error("期次格式应为 YYYY-MM，例如 2026-08");
  const tables = await listTables();
  const recommendationTable = requireRoundTable(tables, "recommendation", round);
  await validateFields(recommendationTable, recommendationRequiredFields);
  const rows = await listRecords(recommendationTable.id);
  const books = rows
    .map((row, index) => {
      const order = Number(textValue(row["顺序"]));
      return {
        title: textValue(row["书名"]),
        recommendation: textValue(row["推荐语"]),
        recommender: textValue(row["推书人"]),
        selected: checkboxValue(row["入选"]),
        order: Number.isFinite(order) && order > 0 ? order : Number.POSITIVE_INFINITY,
        index,
      };
    })
    .filter((book) => book.selected && book.title)
    .sort((left, right) => left.order - right.order || left.index - right.index)
    .map(({ title, recommendation, recommender }) => ({ title, recommendation, recommender }));
  return { round, tableId: recommendationTable.id, books };
}

export async function updateSelectionRecords(tableId: string, records: { recordId: string; fields: Record<string, unknown> }[]) {
  if (!records.length) return;
  const values = config();
  await validateFields({ id: tableId, name: "选书汇总" }, selectionWriteFields);
  for (let offset = 0; offset < records.length; offset += 1000) {
    const batch = records.slice(offset, offset + 1000).map((record) => ({ record_id: record.recordId, fields: record.fields }));
    await request(`/open-apis/bitable/v1/apps/${values.LARK_BASE_TOKEN}/tables/${tableId}/records/batch_update`, {
      method: "POST",
      body: JSON.stringify({ records: batch }),
    }, "写回分组结果");
  }
}
