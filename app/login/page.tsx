import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySessionToken } from "../../lib/auth";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = {
  title: "管理员登录 · 统导工作台",
  robots: { index: false, follow: false },
};

export default async function LoginPage() {
  const cookieStore = await cookies();
  if (await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value)) redirect("/");
  return <main className="login-shell"><LoginForm /></main>;
}
