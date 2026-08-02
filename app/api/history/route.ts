import { getRoundHistory } from "../../../lib/database";

export async function GET() {
  try {
    return Response.json({ ok: true, data: await getRoundHistory() });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "读取历史失败" }, { status: 500 });
  }
}
