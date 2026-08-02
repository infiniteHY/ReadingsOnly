import { isAdminRequest } from "../../../lib/auth";
import { ensureRoundResources, getRoundResources, validRound } from "../../../lib/feishu";

function invalidRound(round: string) {
  return !validRound(round)
    ? Response.json({ ok: false, error: "期次格式应为 YYYY-MM，例如 2026-08" }, { status: 400 })
    : null;
}

export async function GET(request: Request) {
  if (!await isAdminRequest(request)) return Response.json({ ok: false, error: "登录已过期，请重新登录" }, { status: 401 });
  try {
    const round = new URL(request.url).searchParams.get("round")?.trim() ?? "";
    const error = invalidRound(round);
    if (error) return error;
    return Response.json({ ok: true, data: await getRoundResources(round) });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "读取期次表失败" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!await isAdminRequest(request)) return Response.json({ ok: false, error: "登录已过期，请重新登录" }, { status: 401 });
  try {
    const body = await request.json() as { round?: string };
    const round = body.round?.trim() ?? "";
    const error = invalidRound(round);
    if (error) return error;
    return Response.json({ ok: true, data: await ensureRoundResources(round) });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "初始化期次表失败" }, { status: 500 });
  }
}
