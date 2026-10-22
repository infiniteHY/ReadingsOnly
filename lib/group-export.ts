type ExportGroup = { book: string; group: string; members: string[] };

export function groupsCsv(round: string, groups: ExportGroup[]) {
  const escape = (value: string) => /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  const memberCount = Math.max(3, ...groups.map((group) => group.members.length));
  const rows = [
    ["期次", "书名", "组号", ...Array.from({ length: memberCount }, (_, index) => `成员${index + 1}`)],
    ...groups.map((group) => [round, group.book, group.group, ...Array.from({ length: memberCount }, (_, index) => group.members[index] ?? "")]),
  ];
  return `\ufeff${rows.map((row) => row.map(escape).join(",")).join("\r\n")}\r\n`;
}

export function downloadGroupsCsv(round: string, groups: ExportGroup[]) {
  const url = URL.createObjectURL(new Blob([groupsCsv(round, groups)], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${round}-分组结果.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
