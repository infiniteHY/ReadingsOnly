import { env } from "cloudflare:workers";
import type { RecordRow } from "./grouping";

type AppEnv = {
  LARK_APP_ID?: string;
  LARK_APP_SECRET?: string;
  LARK_BASE_TOKEN?: string;
  LARK_MEMBER_TABLE_ID?: string;
  LARK_SELECTION_TABLE_ID?: string;
};

let tokenCache: { token: string; expiresAt: number } | null = null;

function config() {
  const values = env as unknown as AppEnv;
  const required = ["LARK_APP_ID", "LARK_APP_SECRET", "LARK_BASE_TOKEN", "LARK_MEMBER_TABLE_ID", "LARK_SELECTION_TABLE_ID"] as const;
  const missing = required.filter((key) => !values[key]);
  if (missing.length) throw new Error(`部署尚未配置飞书连接：${missing.join("、")}`);
  return values as Required<AppEnv>;
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

async function request(path: string, init?: RequestInit) {
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
  if (!response.ok || data.code !== 0) throw new Error(`飞书接口失败：${data.msg || response.status}`);
  return data.data ?? {};
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

export async function loadFeishuData() {
  const values = config();
  const [members, selections] = await Promise.all([
    listRecords(values.LARK_MEMBER_TABLE_ID),
    listRecords(values.LARK_SELECTION_TABLE_ID),
  ]);
  return { members, selections };
}

export async function updateSelectionRecords(records: { recordId: string; fields: Record<string, unknown> }[]) {
  if (!records.length) return;
  const values = config();
  for (let offset = 0; offset < records.length; offset += 1000) {
    const batch = records.slice(offset, offset + 1000).map((record) => ({ record_id: record.recordId, fields: record.fields }));
    await request(`/open-apis/bitable/v1/apps/${values.LARK_BASE_TOKEN}/tables/${values.LARK_SELECTION_TABLE_ID}/records/batch_update`, {
      method: "POST",
      body: JSON.stringify({ records: batch }),
    });
  }
}
