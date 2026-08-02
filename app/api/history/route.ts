import { isAdminRequest } from "../../../lib/auth";
import { getRoundHistory } from "../../../lib/database";

export async function GET(request: Request) {
  if (!await isAdminRequest(request)) return Response.json({ ok: false, error: "登录已过期，请重新登录" }, { status: 401 });
  try {
    return Response.json({ ok: true, data: await getRoundHistory() });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "读取历史失败" }, { status: 500 });
  }
}
