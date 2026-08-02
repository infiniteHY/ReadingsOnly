import { env } from "cloudflare:workers";
import { isAdminRequest } from "../../../lib/auth";

export async function GET(request: Request) {
  if (!await isAdminRequest(request)) return Response.json({ ok: false, error: "登录已过期，请重新登录" }, { status: 401 });
  const bindings = env as unknown as { DB?: D1Database; LARK_APP_ID?: string; LARK_APP_SECRET?: string; LARK_BASE_TOKEN?: string; LARK_MEMBER_TABLE_ID?: string };
  const configured = Boolean(bindings.DB && bindings.LARK_APP_ID && bindings.LARK_APP_SECRET && bindings.LARK_BASE_TOKEN && bindings.LARK_MEMBER_TABLE_ID);
  return Response.json({ ok: true, configured });
}
