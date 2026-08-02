import { env } from "cloudflare:workers";

export async function GET() {
  const bindings = env as unknown as { DB?: D1Database; LARK_APP_ID?: string; LARK_APP_SECRET?: string };
  const configured = Boolean(bindings.DB && bindings.LARK_APP_ID && bindings.LARK_APP_SECRET);
  return Response.json({ ok: true, configured });
}
