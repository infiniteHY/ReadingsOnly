import { isAdminRequest } from "../../../lib/auth";
import { loadRoundBooks } from "../../../lib/feishu";

export async function GET(request: Request) {
  if (!await isAdminRequest(request)) return Response.json({ ok: false, error: "登录已过期，请重新登录" }, { status: 401 });
  try {
    const round = new URL(request.url).searchParams.get("round")?.trim() ?? "";
    return Response.json({ ok: true, data: await loadRoundBooks(round) });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "读取本期书单失败" }, { status: 500 });
  }
}
