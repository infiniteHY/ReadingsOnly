"use client";

import { useEffect, useMemo, useState } from "react";

const API_URL = "";
const BASE_URL = "https://hcnqf97op6m3.feishu.cn/base/DXHmbEF1OaquxtsGcEPcXGuSntb";

type Group = { book: string; group: string; members: string[] };
type Result = {
  round: string;
  selectionTableId: string;
  applied: boolean;
  historyRound: string | null;
  stats: { active: number; submitted: number; missing: number; groups: number; pending: number; invalid: number };
  missing: string[];
  invalid: { name: string; reason: string }[];
  groups: Group[];
  history?: HistoryItem[];
};
type HistoryGroup = { book: string; group: string; status: string; members: { key: string; name: string }[] };
type HistoryItem = {
  round: string;
  active: number;
  submitted: number;
  missing: number;
  groups: number;
  appliedAt: string;
  groupDetails?: HistoryGroup[];
};
type RoundTableResource = {
  tableId: string;
  tableName: string;
  formId: string | null;
  formName: string | null;
  recordCount: number;
};
type RoundResources = {
  round: string;
  selection: RoundTableResource | null;
  recommendation: RoundTableResource | null;
};
type RoundBook = { title: string; recommendation: string; recommender: string };
type RoundBookList = { round: string; tableId: string; books: RoundBook[] };

async function requestRoundBooks(round: string, signal?: AbortSignal) {
  const response = await fetch(`${API_URL}/api/round-books?round=${encodeURIComponent(round)}`, { signal });
  const payload = await response.json() as { ok: boolean; error?: string; data: RoundBookList };
  if (!response.ok || !payload.ok) throw new Error(payload.error || "读取本期书单失败");
  return payload.data;
}

function wrappedCanvasLines(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = [];
  for (const paragraph of (text || "暂无推荐信息").split(/\r?\n/)) {
    let line = "";
    for (const character of paragraph) {
      const next = line + character;
      if (line && context.measureText(next).width > maxWidth) {
        lines.push(line);
        line = character;
      } else {
        line = next;
      }
    }
    lines.push(line || " ");
  }
  return lines;
}

function Initials({ name }: { name: string }) {
  return <span className="avatar" aria-hidden="true">{name.trim().slice(0, 1) || "?"}</span>;
}

function RoundTableCard({ title, copy, resource }: { title: string; copy: string; resource: RoundTableResource | null }) {
  const tableUrl = resource ? `${BASE_URL}?table=${resource.tableId}` : "";
  const formUrl = resource?.formId ? `${BASE_URL}?table=${resource.tableId}&view=${resource.formId}` : "";
  return (
    <article className={`round-table-card ${resource ? "ready" : "missing"}`}>
      <div className="round-table-title">
        <span>{resource ? "已同步" : "待人工创建"}</span>
        <strong>{title}</strong>
      </div>
      <p>{copy}</p>
      {resource ? (
        <div className="round-table-meta">
          <b>{resource.recordCount}</b><span>条提交</span>
          <div>
            <a href={tableUrl} target="_blank" rel="noreferrer">打开汇总表 ↗</a>
            {formUrl && <a href={formUrl} target="_blank" rel="noreferrer">打开表单 ↗</a>}
          </div>
        </div>
      ) : <small>请先在飞书 Base 中人工创建本期数据表和表单，再回平台同步。</small>}
    </article>
  );
}

export function CoordinatorApp() {
  const [round, setRound] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [backendReady, setBackendReady] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [confirmApply, setConfirmApply] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [expandedHistoryRound, setExpandedHistoryRound] = useState<string | null>(null);
  const [roundResources, setRoundResources] = useState<RoundResources | null>(null);
  const [roundTablesLoading, setRoundTablesLoading] = useState(false);
  const [roundTablesError, setRoundTablesError] = useState("");
  const [syncingRound, setSyncingRound] = useState(false);
  const [roundBookList, setRoundBookList] = useState<RoundBookList | null>(null);
  const [roundBooksLoading, setRoundBooksLoading] = useState(false);
  const [roundBooksError, setRoundBooksError] = useState("");
  const currentRoundResources = roundResources?.round === round.trim() ? roundResources : null;
  const currentRoundBooks = roundBookList?.round === round.trim() ? roundBookList.books : [];

  useEffect(() => {
    fetch(`${API_URL}/api/health`)
      .then((response) => {
        if (response.status === 401) window.location.replace("/login");
        return response.json() as Promise<{ ok: boolean; configured: boolean }>;
      })
      .then((payload) => setBackendReady(payload.ok && payload.configured))
      .catch(() => setBackendReady(false));
    fetch(`${API_URL}/api/history`)
      .then((response) => response.json() as Promise<{ ok: boolean; data: HistoryItem[] }>)
      .then((payload) => payload.ok && setHistory(payload.data))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(round.trim())) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setRoundTablesLoading(true);
      setRoundTablesError("");
      try {
        const response = await fetch(`${API_URL}/api/round-tables?round=${encodeURIComponent(round.trim())}`, { signal: controller.signal });
        const payload = await response.json() as { ok: boolean; error?: string; data: RoundResources };
        if (!response.ok || !payload.ok) throw new Error(payload.error || "读取期次表失败");
        setRoundResources(payload.data);
      } catch (caught) {
        if (!controller.signal.aborted) setRoundTablesError(caught instanceof Error ? caught.message : "读取期次表失败");
      } finally {
        if (!controller.signal.aborted) setRoundTablesLoading(false);
      }
    }, 300);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [round]);

  useEffect(() => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(round.trim())) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setRoundBooksLoading(true);
      setRoundBooksError("");
      try {
        setRoundBookList(await requestRoundBooks(round.trim(), controller.signal));
      } catch (caught) {
        if (!controller.signal.aborted) {
          setRoundBookList(null);
          setRoundBooksError(caught instanceof Error ? caught.message : "读取本期书单失败");
        }
      } finally {
        if (!controller.signal.aborted) setRoundBooksLoading(false);
      }
    }, 300);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [round]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.replace("/login");
  }

  async function syncRoundTables() {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(round.trim())) return setRoundTablesError("期次格式应为 YYYY-MM，例如 2026-08");
    setSyncingRound(true);
    setRoundTablesError("");
    try {
      const response = await fetch(`${API_URL}/api/round-tables`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ round: round.trim() }),
      });
      const payload = await response.json() as { ok: boolean; error?: string; data: RoundResources };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "同步期次表失败");
      setRoundResources(payload.data);
      try {
        setRoundBookList(await requestRoundBooks(round.trim()));
        setRoundBooksError("");
      } catch (caught) {
        setRoundBookList(null);
        setRoundBooksError(caught instanceof Error ? caught.message : "读取本期书单失败");
      }
      setBackendReady(true);
    } catch (caught) {
      setRoundTablesError(caught instanceof Error ? caught.message : "同步期次表失败");
    } finally {
      setSyncingRound(false);
    }
  }

  async function run(apply: boolean) {
    if (!round.trim()) return setError("请先填写期次");
    setLoading(true);
    setError("");
    setConfirmApply(false);
    try {
      const response = await fetch(`${API_URL}/api/grouping`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ round: round.trim(), apply }),
      });
      const payload = await response.json() as { ok: boolean; error?: string; data: Result };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "运行失败");
      setResult(payload.data);
      if (payload.data.history) {
        setHistory(payload.data.history);
        setExpandedHistoryRound(payload.data.round);
      }
      setBackendReady(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法连接统导后端");
      setBackendReady(false);
    } finally {
      setLoading(false);
    }
  }

  const groupedBooks = useMemo(() => {
    const books = new Map<string, Group[]>();
    for (const group of result?.groups ?? []) {
      const rows = books.get(group.book) ?? [];
      rows.push(group);
      books.set(group.book, rows);
    }
    return [...books.entries()];
  }, [result]);

  const expandedHistory = history.find((item) => item.round === expandedHistoryRound) ?? null;
  const expandedHistoryBooks = useMemo(() => {
    const books = new Map<string, HistoryGroup[]>();
    for (const group of expandedHistory?.groupDetails ?? []) {
      books.set(group.book, [...(books.get(group.book) ?? []), group]);
    }
    return [...books.entries()];
  }, [expandedHistory]);

  function downloadCsv() {
    if (!result) return;
    const escape = (value: string) => /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
    const lines = [["期次", "书名", "组号", "成员1", "成员2", "成员3"]];
    for (const group of result.groups) {
      lines.push([result.round, group.book, group.group, group.members[0] ?? "", group.members[1] ?? "", group.members[2] ?? ""]);
    }
    const blob = new Blob([`\ufeff${lines.map((line) => line.map(escape).join(",")).join("\r\n")}\r\n`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${result.round}-分组结果.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadBookListCard() {
    if (!currentRoundBooks.length) return;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return setRoundBooksError("当前浏览器无法生成图片，请更换浏览器后重试");
    const width = 1080;
    const padding = 76;
    const contentWidth = width - padding * 2;
    context.font = '28px "PingFang SC", "Microsoft YaHei", sans-serif';
    const layouts = currentRoundBooks.map((book) => {
      context.font = '600 42px "Songti SC", "STSong", serif';
      const titleLines = wrappedCanvasLines(context, book.title, contentWidth - 154);
      context.font = '28px "PingFang SC", "Microsoft YaHei", sans-serif';
      const recommendationLines = wrappedCanvasLines(context, book.recommendation, contentWidth - 154);
      const height = 86 + titleLines.length * 54 + recommendationLines.length * 42 + 72;
      return { book, titleLines, recommendationLines, height };
    });
    const headerHeight = 292;
    const gap = 22;
    const footerHeight = 108;
    canvas.width = width;
    canvas.height = headerHeight + layouts.reduce((sum, layout) => sum + layout.height, 0) + gap * (layouts.length - 1) + footerHeight;

    context.fillStyle = "#f3eee3";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#173d35";
    context.fillRect(0, 0, 18, canvas.height);
    context.fillStyle = "#e96f3c";
    context.beginPath();
    context.arc(width - 92, 82, 122, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "rgba(255,253,247,.3)";
    context.beginPath();
    context.arc(width - 44, 142, 94, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = "#e96f3c";
    context.font = '700 22px "PingFang SC", sans-serif';
    context.fillText(`READING CLUB  /  ${round.trim()}`, padding, 76);
    context.fillStyle = "#173d35";
    context.font = '600 82px "Songti SC", "STSong", serif';
    context.fillText("本期书单", padding, 170);
    context.fillStyle = "#60766f";
    context.font = '26px "PingFang SC", sans-serif';
    context.fillText(`书单期号 ${round.trim()}  ·  共 ${currentRoundBooks.length} 本`, padding, 224);
    context.fillStyle = "#173d35";
    context.fillRect(padding, 258, 92, 4);

    let y = headerHeight;
    layouts.forEach((layout, index) => {
      context.fillStyle = "#fffdf7";
      context.strokeStyle = "#d9d4c9";
      context.lineWidth = 2;
      context.beginPath();
      context.roundRect(padding, y, contentWidth, layout.height, 18);
      context.fill();
      context.stroke();

      context.fillStyle = index % 2 === 0 ? "#173d35" : "#e96f3c";
      context.beginPath();
      context.arc(padding + 58, y + 60, 30, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = "#fffdf7";
      context.font = '700 20px Georgia, serif';
      context.textAlign = "center";
      context.fillText(String(index + 1).padStart(2, "0"), padding + 58, y + 67);
      context.textAlign = "left";

      let lineY = y + 52;
      context.fillStyle = "#173d35";
      context.font = '600 42px "Songti SC", "STSong", serif';
      for (const line of layout.titleLines) {
        context.fillText(line, padding + 116, lineY);
        lineY += 54;
      }
      lineY += 16;
      context.fillStyle = "#e96f3c";
      context.font = '700 18px "PingFang SC", sans-serif';
      context.fillText("推荐信息", padding + 116, lineY);
      lineY += 42;
      context.fillStyle = "#405e57";
      context.font = '28px "PingFang SC", "Microsoft YaHei", sans-serif';
      for (const line of layout.recommendationLines) {
        context.fillText(line, padding + 116, lineY);
        lineY += 42;
      }
      context.fillStyle = "#60766f";
      context.font = '22px "PingFang SC", sans-serif';
      context.fillText(`推荐人  ${layout.book.recommender || "未填写"}`, padding + 116, y + layout.height - 34);
      y += layout.height + gap;
    });

    context.fillStyle = "#173d35";
    context.font = '600 22px "Songti SC", "STSong", serif';
    context.fillText("阅读社 · 让好书遇见同路的人", padding, canvas.height - 48);
    context.fillStyle = "#8a9a95";
    context.font = '18px "PingFang SC", sans-serif';
    context.textAlign = "right";
    context.fillText("书单来自飞书入选记录", width - padding, canvas.height - 48);
    context.textAlign = "left";

    const anchor = document.createElement("a");
    anchor.href = canvas.toDataURL("image/png");
    anchor.download = `${round.trim()}-本期书单.png`;
    anchor.click();
  }

  return (
    <main>
      <header className="topbar">
        <a className="brand" href={BASE_URL} target="_blank" rel="noreferrer">
          <span className="brand-mark">阅</span>
          <span>阅读社 · 统导</span>
        </a>
        <div className="topbar-actions">
          <div className={`connection ${backendReady === false ? "offline" : ""}`}>
            <span className="connection-dot" />
            {backendReady === null ? "正在连接" : backendReady ? "飞书与数据库就绪" : "等待部署配置"}
          </div>
          <button className="logout-button" onClick={logout}>退出</button>
        </div>
      </header>

      <section className="hero">
        <div className="eyebrow"><span>本期工作台</span><i /></div>
        <h1>把选书名单，变成<br /><em>合适的讨论小组。</em></h1>
        <p>读取飞书名单，自动找出漏选成员，并优先匹配还没有一起讨论过的人。</p>
      </section>

      <section className="round-tables-panel" aria-label="期次收集表">
        <div className="round-tables-heading">
          <div><span>按期次归档</span><h2>{round || "本期"} 收集中心</h2></div>
          <p>每一期先在飞书人工创建推书汇总、选书汇总及表单，平台只负责同步、读取和写回分组。</p>
        </div>
        <div className="round-table-grid">
          <RoundTableCard title="推书汇总" copy="社员按本期荐书，书导在该表勾选最终入选书目。" resource={currentRoundResources?.recommendation ?? null} />
          <RoundTableCard title="选书汇总" copy="社员从本期 6 本书中选择 1—3 本，统导在该表完成分组。" resource={currentRoundResources?.selection ?? null} />
        </div>
        <div className="round-tables-actions">
          <span>{roundTablesLoading ? "正在检查飞书期次表…" : roundTablesError || (currentRoundResources?.selection && currentRoundResources?.recommendation ? "已发现本期人工创建的汇总表；可再次同步校验字段。" : "请先在飞书人工建表，再点击同步。平台不会创建或修改表结构。")}</span>
          <button className="button primary" onClick={syncRoundTables} disabled={syncingRound || roundTablesLoading}>
            {syncingRound ? "正在同步…" : `同步 ${round || "本期"}`}
          </button>
        </div>
      </section>

      <section className="current-books-panel" aria-label={`${round || "本期"} 本期书单`}>
        <div className="current-books-heading">
          <div>
            <span>CURATED READING LIST</span>
            <h2>本期书单</h2>
            <p>书单期号 <b>{round || "—"}</b> · 仅展示“推书汇总”中已勾选入选的书目</p>
          </div>
          <button className="booklist-export" type="button" onClick={downloadBookListCard} disabled={!currentRoundBooks.length || roundBooksLoading}>
            <span>导出图片卡片</span><b>PNG ↘</b>
          </button>
        </div>
        {roundBooksError && <div className="booklist-notice error"><b>书单同步失败</b><span>{roundBooksError}</span></div>}
        {roundBooksLoading ? (
          <div className="booklist-notice"><span>正在同步本期入选书目…</span></div>
        ) : currentRoundBooks.length ? (
          <div className="current-books-grid">
            {currentRoundBooks.map((book, index) => (
              <article key={`${book.title}-${index}`}>
                <div className="current-book-number">{String(index + 1).padStart(2, "0")}</div>
                <div className="current-book-copy">
                  <h3>{book.title}</h3>
                  <span>推荐信息</span>
                  <p>{book.recommendation || "暂无推荐信息"}</p>
                  <small>推荐人 · <b>{book.recommender || "未填写"}</b></small>
                </div>
              </article>
            ))}
          </div>
        ) : !roundBooksError ? (
          <div className="booklist-empty">
            <span>暂无入选书目</span>
            <p>请在“推书汇总｜{round || "本期"}”中勾选“入选”，再点击上方同步。</p>
          </div>
        ) : null}
      </section>

      <section className="run-panel" aria-label="运行分组">
        <label htmlFor="round">本期期次</label>
        <div className="run-row">
          <input
            id="round"
            value={round}
            onChange={(event) => setRound(event.target.value)}
            placeholder="例如 2026-08"
            disabled={loading}
          />
          <button className="button secondary" onClick={() => run(false)} disabled={loading || roundTablesLoading || currentRoundResources?.selection === null}>
            {loading ? "正在读取…" : "预览结果"}
          </button>
          <button className="button primary" onClick={() => setConfirmApply(true)} disabled={loading || !result || currentRoundResources?.selection === null}>
            确认并写回飞书
          </button>
        </div>
        <div className="run-note">
          <span>分组只读取“选书汇总｜{round || "本期"}”</span>
          <a href={BASE_URL} target="_blank" rel="noreferrer">打开飞书原表 ↗</a>
        </div>
      </section>

      {error && <div className="error-banner" role="alert"><b>运行失败</b><span>{error}</span></div>}

      {!result && !error && (
        <section className="empty-state">
          <div className="empty-number">01</div>
          <div><h2>先做一次安全预览</h2><p>不会修改飞书。你会先看到漏选名单、无效提交和完整分组。</p></div>
          <div className="empty-line" />
          <div className="empty-number">02</div>
          <div><h2>确认后保存历史</h2><p>组号写回飞书，同时将选书与分组存入 D1，供下一期避开老搭档。</p></div>
        </section>
      )}

      {result && (
        <section className="results" aria-live="polite">
          <div className="result-heading">
            <div><span className="section-kicker">{result.round}</span><h2>{result.applied ? "已写回的分组结果" : "分组预览"}</h2></div>
            <button className="download" onClick={downloadCsv}>下载 CSV ↓</button>
          </div>

          <div className="stats-grid">
            <article><span>在籍社员</span><strong>{result.stats.active}</strong><small>人</small></article>
            <article><span>有效选书</span><strong>{result.stats.submitted}</strong><small>人</small></article>
            <article className={result.stats.missing ? "attention" : ""}><span>本期漏选</span><strong>{result.stats.missing}</strong><small>人</small></article>
            <article><span>讨论小组</span><strong>{result.stats.groups}</strong><small>组</small></article>
          </div>

          <div className="summary-grid">
            <article className="summary-card">
              <div className="card-title"><h3>漏选名单</h3><span>{result.missing.length}</span></div>
              {result.missing.length ? (
                <div className="people-list">{result.missing.map((name) => <span key={name}><Initials name={name} />{name}</span>)}</div>
              ) : <p className="all-clear">所有在籍社员都已完成选书。</p>}
            </article>
            <article className="summary-card">
              <div className="card-title"><h3>提交检查</h3><span>{result.stats.invalid}</span></div>
              {result.invalid.length ? (
                <div className="invalid-list">{result.invalid.map((item, index) => <p key={`${item.name}-${index}`}><b>{item.name}</b><span>{item.reason}</span></p>)}</div>
              ) : <p className="all-clear">没有发现姓名或重复选书问题。</p>}
            </article>
          </div>

          <div className="groups-section">
            <div className="groups-heading"><h3>按书分组</h3><p>历史参考期：{result.historyRound ?? "暂无历史记录"}</p></div>
            {groupedBooks.length ? groupedBooks.map(([book, groups], bookIndex) => (
              <article className="book-block" key={book}>
                <div className="book-index">{String(bookIndex + 1).padStart(2, "0")}</div>
                <div className="book-content">
                  <h4>{book}</h4>
                  <div className="book-groups">
                    {groups.map((group) => (
                      <div className={`group-row ${group.group === "待协调" ? "pending" : ""}`} key={`${book}-${group.group}`}>
                        <span className="group-label">{group.group === "待协调" ? "待协调" : `第 ${group.group} 组`}</span>
                        <div>{group.members.map((name) => <span className="member" key={name}><Initials name={name} />{name}</span>)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </article>
            )) : <div className="no-groups">本期还没有可分组的有效选书记录。</div>}
          </div>
        </section>
      )}

      {history.length > 0 && (
        <section className="history-section">
          <div className="groups-heading"><h3>数据库历史</h3><p>后续分组会自动避开这些历史搭档</p></div>
          <div className="history-list">
            {history.map((item) => (
              <article className={expandedHistoryRound === item.round ? "expanded" : ""} key={item.round}>
                <button
                  type="button"
                  aria-expanded={expandedHistoryRound === item.round}
                  onClick={() => setExpandedHistoryRound((current) => current === item.round ? null : item.round)}
                >
                  <strong>{item.round}</strong>
                  <span>{item.submitted} 人 · {item.groups} 组</span>
                  <small>{new Date(item.appliedAt).toLocaleDateString("zh-CN")} · {expandedHistoryRound === item.round ? "收起明细 ↑" : "查看分组 ↓"}</small>
                </button>
              </article>
            ))}
          </div>
          {expandedHistory && (
            <div className="history-detail" aria-label={`${expandedHistory.round} 历史分组明细`}>
              <div className="history-detail-heading">
                <strong>{expandedHistory.round} 分组明细</strong>
                <span>{expandedHistory.groups} 组 · 后续贪心分组已纳入这些搭档关系</span>
              </div>
              {expandedHistoryBooks.length ? expandedHistoryBooks.map(([book, groups]) => (
                <section key={book}>
                  <h4>{book}</h4>
                  <div>
                    {groups.map((group) => (
                      <p key={`${book}-${group.group}`}>
                        <b>{group.group === "待协调" ? "待协调" : `第 ${group.group} 组`}</b>
                        <span>{group.members.map((member) => member.name).join("、") || "暂无成员"}</span>
                      </p>
                    ))}
                  </div>
                </section>
              )) : <p className="all-clear">该期只有汇总记录，暂无可展示的分组成员明细。</p>}
            </div>
          )}
        </section>
      )}

      {confirmApply && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setConfirmApply(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title" onMouseDown={(event) => event.stopPropagation()}>
            <span className="modal-icon">写</span>
            <h2 id="confirm-title">写回 {round} 的分组？</h2>
            <p>将更新飞书中的有效状态和组号，并覆盖保存本期数据库记录，供下次避开历史搭档。</p>
            <div className="modal-actions">
              <button className="button secondary" onClick={() => setConfirmApply(false)}>取消</button>
              <button className="button primary" onClick={() => run(true)}>确认写回</button>
            </div>
          </div>
        </div>
      )}

      <footer><span>阅读社统导工作台</span><span>数据来自飞书 · 分组历史存入 Cloudflare D1</span></footer>
    </main>
  );
}
