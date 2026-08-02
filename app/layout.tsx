import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const base = new URL(`${protocol}://${host}`);
  const imageUrl = new URL("/og.png", base).toString();
  return {
    metadataBase: base,
    title: "统导工作台 · 阅读社",
    description: "读取飞书选书名单，统计漏选并生成讨论分组。",
    openGraph: {
      title: "统导工作台 · 阅读社",
      description: "把选书名单，变成合适的讨论小组。",
      images: [{ url: imageUrl, width: 1680, height: 945 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "统导工作台 · 阅读社",
      description: "把选书名单，变成合适的讨论小组。",
      images: [imageUrl],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
