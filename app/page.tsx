import type { Metadata } from "next";
import { CoordinatorApp } from "./CoordinatorApp";

export const metadata: Metadata = {
  title: "统导工作台",
  description: "读取飞书选书名单，统计漏选并生成讨论分组。",
};

export default function Home() {
  return <CoordinatorApp />;
}
