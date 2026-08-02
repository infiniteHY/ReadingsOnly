"use client";

import { FormEvent, useState } from "react";

export function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "admin", password }),
      });
      const payload = await response.json() as { ok: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "登录失败");
      window.location.replace("/");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "登录失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="login-card" onSubmit={submit}>
      <div className="login-mark">阅</div>
      <p className="login-kicker">READING CLUB</p>
      <h1>统导工作台</h1>
      <p className="login-copy">仅限管理员使用。登录后可读取选书名单、分组并写回飞书。</p>
      <label htmlFor="username">账户</label>
      <input id="username" value="admin" readOnly autoComplete="username" />
      <label htmlFor="password">密码</label>
      <input
        id="password"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        autoComplete="current-password"
        autoFocus
        required
      />
      {error && <p className="login-error" role="alert">{error}</p>}
      <button className="button primary login-submit" disabled={loading || !password}>
        {loading ? "正在登录…" : "进入工作台"}
      </button>
      <small>账户固定为 admin · 会话有效 12 小时</small>
    </form>
  );
}
