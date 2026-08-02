import { createSessionToken, sessionCookie, verifyAdminCredentials } from "../../../../lib/auth";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { username?: string; password?: string };
    const username = body.username?.trim() ?? "";
    const password = body.password ?? "";
    if (!await verifyAdminCredentials(username, password)) {
      return Response.json({ ok: false, error: "用户名或密码错误" }, { status: 401 });
    }
    const response = Response.json({ ok: true });
    response.headers.set("Set-Cookie", sessionCookie(await createSessionToken(), new URL(request.url).protocol === "https:"));
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "登录失败" }, { status: 500 });
  }
}
