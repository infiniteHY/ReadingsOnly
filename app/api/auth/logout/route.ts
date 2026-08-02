import { clearSessionCookie } from "../../../../lib/auth";

export async function POST(request: Request) {
  const response = Response.json({ ok: true });
  response.headers.set("Set-Cookie", clearSessionCookie(new URL(request.url).protocol === "https:"));
  response.headers.set("Cache-Control", "no-store");
  return response;
}
