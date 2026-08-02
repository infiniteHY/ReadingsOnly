import { env } from "cloudflare:workers";
import type { RecordRow } from "./grouping";
import { SELECTION_GROUP_FIELDS, SELECTION_STATUS_FIELD } from "./selection-schema";

type AppEnv = {
  LARK_APP_ID?: string;
  LARK_APP_SECRET?: string;
  LARK_BASE_TOKEN?: string;
  LARK_MEMBER_TABLE_ID?: string;
};

type TableItem = { id: string; name: string };
type FormItem = { id: string; name: string; description?: string };
type FieldItem = { id: string; name: string; type: string };
type FieldDefinition = Record<string, unknown> & { name: string; type: string };

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

const SELECTION_PREFIX = "选书汇总｜";
const RECOMMENDATION_PREFIX = "推书汇总｜";

const selectionInputFields: FieldDefinition[] = [
  { type: "text", name: "姓名/昵称", style: { type: "plain" } },
  { type: "text", name: "校验码", style: { type: "plain" } },
  { type: "select", name: "选书1", multiple: false, options: [{ name: "待设置", hue: "Gray", lightness: "Lighter" }] },
  { type: "select", name: "选书2", multiple: false, options: [{ name: "待设置", hue: "Gray", lightness: "Lighter" }] },
  { type: "select", name: "选书3", multiple: false, options: [{ name: "待设置", hue: "Gray", lightness: "Lighter" }] },
];

const selectionAdminFields: FieldDefinition[] = [
  { type: "text", name: SELECTION_STATUS_FIELD, description: "由统导平台回写：有效、已替代或具体错误原因", style: { type: "plain" } },
  ...SELECTION_GROUP_FIELDS.map((name) => ({ type: "text", name, description: "由统导平台回写", style: { type: "plain" } })),
  { type: "created_at", name: "提交时间", style: { format: "yyyy-MM-dd HH:mm" } },
];

const recommendationInputFields: FieldDefinition[] = [
  { type: "text", name: "书名", style: { type: "plain" } },
  { type: "text", name: "推书人", style: { type: "plain" } },
  { type: "text", name: "推荐语", style: { type: "plain" } },
];

const recommendationAdminFields: FieldDefinition[] = [
  { type: "checkbox", name: "入选", description: "由书导人工勾选" },
  { type: "number", name: "顺序", description: "由书导填写最终书单顺序", style: { type: "plain", precision: 0, percentage: false, thousands_separator: false } },
  { type: "created_at", name: "提交时间", style: { format: "yyyy-MM-dd HH:mm" } },
];

const selectionQuestions = [
  { name: "姓名/昵称", description: "请填写社员名单中的姓名或昵称", required: true },
  { name: "校验码", description: "请填写社员校验码", required: true },
  { name: "选书1", description: "至少选择一本书", required: true, option_display_mode: 1 },
  { name: "选书2", description: "可选第二本，不要与第一本重复", required: false, option_display_mode: 1 },
  { name: "选书3", description: "可选第三本，不要与前两本重复", required: false, option_display_mode: 1 },
];

const recommendationQuestions = [
  { name: "书名", description: "请填写完整书名", required: true },
  { name: "推书人", description: "请填写群昵称或姓名", required: true },
  { name: "推荐语", description: "请用一两句话说明推荐理由", required: true },
];

let tokenCache: { token: string; expiresAt: number } | null = null;

const FEISHU_READY_RETRY_DELAYS_MS = [250, 500, 1_000, 2_000, 3_000];

type RequestOptions = {
  operation?: string;
  retryNotFound?: boolean;
};

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

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isNotFound(response: Response, data: { code: number; msg: string }) {
  const message = String(data.msg ?? "").toLowerCase().replaceAll("_", " ");
  return response.status === 404 || message === "not found" || message.includes("not found");
}

async function request(path: string, init?: RequestInit, options: RequestOptions = {}) {
  for (let attempt = 0; ; attempt += 1) {
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

    const retryDelay = FEISHU_READY_RETRY_DELAYS_MS[attempt];
    if (options.retryNotFound && retryDelay !== undefined && isNotFound(response, data)) {
      await sleep(retryDelay);
      continue;
    }

    const operation = options.operation ? `${options.operation}：` : "";
    const code = data.code ? `（code ${data.code}）` : "";
    throw new Error(`飞书接口失败：${operation}${data.msg || response.status}${code}`);
  }
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

async function listFields(tableId: string, waitUntilReady = false): Promise<FieldItem[]> {
  const values = config();
  const data = await request(
    `/open-apis/base/v3/bases/${values.LARK_BASE_TOKEN}/tables/${tableId}/fields?offset=0&limit=200`,
    undefined,
    { operation: "读取新建数据表字段", retryNotFound: waitUntilReady },
  );
  const items = (data.items ?? data.fields ?? []) as Record<string, unknown>[];
  return items.map((item) => ({ id: itemId(item), name: String(item.name ?? item.field_name ?? ""), type: String(item.type ?? "") })).filter((item) => item.id && item.name);
}

async function listForms(tableId: string, waitUntilReady = false): Promise<FormItem[]> {
  const values = config();
  const data = await request(
    `/open-apis/base/v3/bases/${values.LARK_BASE_TOKEN}/tables/${tableId}/forms?page_size=100`,
    undefined,
    { operation: "读取新建数据表表单", retryNotFound: waitUntilReady },
  );
  const items = (data.forms ?? data.items ?? []) as Record<string, unknown>[];
  return items.map((item) => ({
    id: itemId(item),
    name: String(item.name ?? ""),
    description: item.description ? String(item.description) : undefined,
  })).filter((item) => item.id && item.name);
}

async function listFormQuestions(tableId: string, formId: string, waitUntilReady = false) {
  const values = config();
  const data = await request(
    `/open-apis/base/v3/bases/${values.LARK_BASE_TOKEN}/tables/${tableId}/forms/${formId}/questions`,
    undefined,
    { operation: "读取新建表单题目", retryNotFound: waitUntilReady },
  );
  return (data.questions ?? data.items ?? []) as Record<string, unknown>[];
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

async function createTable(name: string) {
  const values = config();
  const data = await request(`/open-apis/base/v3/bases/${values.LARK_BASE_TOKEN}/tables`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  const table = (data.table ?? data) as Record<string, unknown>;
  const id = itemId(table);
  if (!id) throw new Error(`飞书已创建“${name}”，但没有返回数据表 ID`);
  return { id, name };
}

async function createField(tableId: string, field: FieldDefinition) {
  const values = config();
  const data = await request(`/open-apis/base/v3/bases/${values.LARK_BASE_TOKEN}/tables/${tableId}/fields`, {
    method: "POST",
    body: JSON.stringify(field),
  });
  const result = (data.field ?? data) as Record<string, unknown>;
  const id = itemId(result);
  if (!id) throw new Error(`字段“${field.name}”创建成功但没有返回字段 ID`);
  return { id, name: field.name, type: field.type };
}

async function ensureFields(tableId: string, definitions: FieldDefinition[], fields: FieldItem[]) {
  for (const definition of definitions) {
    const existing = fields.find((field) => field.name === definition.name);
    if (!existing) {
      fields.push(await createField(tableId, definition));
      continue;
    }
    if (existing.type !== definition.type) {
      throw new Error(`飞书字段“${definition.name}”类型应为 ${definition.type}，当前为 ${existing.type}`);
    }
  }
}

async function createForm(tableId: string, name: string, description: string) {
  const values = config();
  const data = await request(`/open-apis/base/v3/bases/${values.LARK_BASE_TOKEN}/tables/${tableId}/forms`, {
    method: "POST",
    body: JSON.stringify({ name, description }),
  }, { operation: `创建“${name}”`, retryNotFound: true });
  const form = (data.form ?? data) as Record<string, unknown>;
  const id = itemId(form);
  if (!id) throw new Error(`飞书已创建“${name}”，但没有返回表单 ID`);
  return { id, name, description };
}

async function configureForm(
  tableId: string,
  form: FormItem,
  desired: { name: string; description: string; required: boolean; option_display_mode?: number }[],
  waitUntilReady = false,
) {
  const values = config();
  const questions = await listFormQuestions(tableId, form.id, waitUntilReady);
  const byName = new Map(questions.map((question) => [String(question.title ?? question.name ?? ""), itemId(question)]));
  const updates = desired.map((question) => ({
    id: byName.get(question.name),
    title: question.name,
    description: question.description,
    required: question.required,
    ...(question.option_display_mode === undefined ? {} : { option_display_mode: question.option_display_mode }),
  })).filter((question) => question.id);
  if (updates.length) {
    await request(`/open-apis/base/v3/bases/${values.LARK_BASE_TOKEN}/tables/${tableId}/forms/${form.id}/questions`, {
      method: "PATCH",
      body: JSON.stringify({ questions: updates }),
    }, { operation: "配置表单题目", retryNotFound: waitUntilReady });
  }
}

async function ensureResource(kind: "selection" | "recommendation", round: string, knownTables: TableItem[]) {
  const tableName = roundTableName(kind, round);
  let table = knownTables.find((item) => item.name === tableName);
  let tableWasCreated = false;
  if (!table) {
    table = await createTable(tableName);
    knownTables.push(table);
    tableWasCreated = true;
  }

  const inputFields = kind === "selection" ? selectionInputFields : recommendationInputFields;
  const adminFields = kind === "selection" ? selectionAdminFields : recommendationAdminFields;
  const fields = await listFields(table.id, tableWasCreated);
  await ensureFields(table.id, inputFields, fields);

  const formName = `${round} ${kind === "selection" ? "选书" : "荐书"}表单`;
  const description = kind === "selection"
    ? `${round} 期选书。请填写姓名/昵称和校验码，并选择 1—3 本书；重复提交时以最新有效记录为准。`
    : `${round} 期荐书。请填写推书人、完整书名和推荐语；最终书单由书导人工确定。`;
  const forms = await listForms(table.id, tableWasCreated);
  const existingForm = forms.find((item) => item.name === formName);
  const form = existingForm ?? await createForm(table.id, formName, description);
  await configureForm(
    table.id,
    form,
    kind === "selection" ? selectionQuestions : recommendationQuestions,
    !existingForm,
  );
  // 后台字段必须在表单创建和配置完成后再添加。飞书的“删除表单题目”
  // 会同时删除底层数据表字段；后添加的字段则保留在表中且不会暴露给填写者。
  await ensureFields(table.id, adminFields, fields);
  return table;
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

export async function getRoundResources(round: string): Promise<RoundResources> {
  if (!validRound(round)) throw new Error("期次格式应为 YYYY-MM，例如 2026-08");
  const tables = await listTables();
  const selectionTable = tables.find((item) => item.name === roundTableName("selection", round));
  const recommendationTable = tables.find((item) => item.name === roundTableName("recommendation", round));
  const [selection, recommendation] = await Promise.all([
    resourceFor(selectionTable, `${round} 选书表单`),
    resourceFor(recommendationTable, `${round} 荐书表单`),
  ]);
  return { round, selection, recommendation };
}

export async function ensureRoundResources(round: string) {
  if (!validRound(round)) throw new Error("期次格式应为 YYYY-MM，例如 2026-08");
  const tables = await listTables();
  await ensureResource("recommendation", round, tables);
  await ensureResource("selection", round, tables);
  return getRoundResources(round);
}

export async function loadFeishuData(round: string) {
  const values = config();
  const tables = await listTables();
  const selectionTable = tables.find((item) => item.name === roundTableName("selection", round));
  if (!selectionTable) throw new Error(`尚未创建“${roundTableName("selection", round)}”，请先初始化本期期次表`);
  const [members, rawSelections] = await Promise.all([
    listRecords(values.LARK_MEMBER_TABLE_ID),
    listRecords(selectionTable.id),
  ]);
  const selections = rawSelections.map((row) => ({ ...row, "期次": round }));
  return { members, selections, selectionTableId: selectionTable.id };
}

export async function updateSelectionRecords(tableId: string, records: { recordId: string; fields: Record<string, unknown> }[]) {
  if (!records.length) return;
  const values = config();
  const fields = await listFields(tableId, true);
  await ensureFields(tableId, selectionAdminFields, fields);
  for (let offset = 0; offset < records.length; offset += 1000) {
    const batch = records.slice(offset, offset + 1000).map((record) => ({ record_id: record.recordId, fields: record.fields }));
    await request(`/open-apis/bitable/v1/apps/${values.LARK_BASE_TOKEN}/tables/${tableId}/records/batch_update`, {
      method: "POST",
      body: JSON.stringify({ records: batch }),
    });
  }
}
