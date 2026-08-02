import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySessionToken } from "../lib/auth";
import { CoordinatorApp } from "./CoordinatorApp";

export const metadata: Metadata = {
  title: "统导工作台",
  description: "读取飞书选书名单，统计漏选并生成讨论分组。",
};

export default async function Home() {
  const cookieStore = await cookies();
  if (!await verifySessionToken(cookieStore.get(SESSION_COOKIE)?.value)) redirect("/login");
  return <CoordinatorApp />;
}
