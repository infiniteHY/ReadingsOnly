import { SELECTION_GROUP_FIELDS, SELECTION_STATUS_FIELD } from "./selection-schema";

export type RecordRow = Record<string, unknown> & { recordId?: string };
export type History = { counts: Map<string, number>; lastPairs: Set<string>; lastRound: string };

const choices = ["选书1", "选书2", "选书3"] as const;

export function textValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join("");
  if (typeof value === "object") {
    const item = value as Record<string, unknown>;
    return textValue(item.text ?? item.name ?? item.value ?? item.label ?? "");
  }
  return String(value).trim();
}

export function normalized(value: unknown): string {
  return textValue(value).normalize("NFKC").trim().toLocaleLowerCase("zh-CN");
}

function boolValue(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  return ["1", "true", "是", "yes", "y"].includes(normalized(value));
}

function timestamp(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value < 10_000_000_000 ? value * 1000 : value;
  const raw = textValue(value);
  if (!raw) return 0;
  if (/^\d+$/.test(raw)) {
    const number = Number(raw);
    return number < 10_000_000_000 ? number * 1000 : number;
  }
  const parsed = Date.parse(raw.replace(" ", "T"));
  return Number.isNaN(parsed) ? 0 : parsed;
}

export type Evaluation = {
  row: RecordRow;
  key: string;
  name: string;
  choices: string[];
  choiceSlots: { book: string; choiceIndex: number }[];
  error: string;
  status: string;
  effective: boolean;
  submittedAt: number;
  index: number;
};

export function validateSelections(memberRows: RecordRow[], selectionRows: RecordRow[], round: string) {
  const directory = new Map<string, { key: string; name: string; code: string }[]>();
  for (const row of memberRows) {
    if (!boolValue(row["是否在籍"])) continue;
    const key = normalized(row["姓名/昵称"]);
    if (!key) continue;
    const member = { key, name: textValue(row["姓名/昵称"]), code: textValue(row["校验码"]) };
    directory.set(key, [...(directory.get(key) ?? []), member]);
  }
  const evaluations: Evaluation[] = selectionRows
    .filter((row) => normalized(row["期次"]) === normalized(round))
    .map((row, index) => {
      const key = normalized(row["姓名/昵称"]);
      const members = directory.get(key) ?? [];
      const choiceSlots = choices.map((field, choiceIndex) => ({ book: textValue(row[field]), choiceIndex }))
        .filter(({ book }) => book && normalized(book) !== "待设置");
      const selected = choiceSlots.map(({ book }) => book);
      let error = "";
      if (!key) error = "缺少姓名";
      else if (members.length === 0) error = "姓名不在社员名单";
      else if (members.length > 1) error = "社员名单姓名重复";
      else if (textValue(row["校验码"]) !== members[0].code) error = "校验码错误";
      else if (selected.length === 0) error = "未选择书籍";
      else if (new Set(selected.map(normalized)).size !== selected.length) error = "选书重复";
      return {
        row, index, key, choiceSlots, choices: selected, error,
        name: members[0]?.name ?? textValue(row["姓名/昵称"]),
        submittedAt: timestamp(row["提交时间"]),
        effective: false,
        status: error,
      };
    });
  const validByMember = new Map<string, Evaluation[]>();
  for (const item of evaluations.filter((item) => !item.error)) {
    validByMember.set(item.key, [...(validByMember.get(item.key) ?? []), item]);
  }
  for (const items of validByMember.values()) {
    items.sort((a, b) => b.submittedAt - a.submittedAt || b.index - a.index);
    items[0].effective = true;
    items[0].status = "有效";
    for (const older of items.slice(1)) older.status = "已替代";
  }
  const effective = evaluations.filter((item) => item.effective);
  const activeMembers = [...directory.values()].filter((items) => items.length === 1).map(([item]) => item);
  const effectiveKeys = new Set(effective.map((item) => item.key));
  const missing = activeMembers.filter((member) => !effectiveKeys.has(member.key));
  return { evaluations, effective, activeMembers, missing };
}

function pairKey(a: string, b: string) { return [a, b].sort().join("\u0000"); }

export function historyFromRows(rows: { round: string; groupId: string; memberKey: string; createdAt: string }[]): History {
  const byGroup = new Map<string, { round: string; names: Set<string> }>();
  const roundLatest = new Map<string, number>();
  for (const row of rows) {
    const entry = byGroup.get(row.groupId) ?? { round: row.round, names: new Set<string>() };
    entry.names.add(row.memberKey);
    byGroup.set(row.groupId, entry);
    roundLatest.set(row.round, Math.max(roundLatest.get(row.round) ?? 0, Date.parse(row.createdAt) || 0));
  }
  const lastRound = [...roundLatest.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).at(-1)?.[0] ?? "";
  const counts = new Map<string, number>();
  const lastPairs = new Set<string>();
  for (const entry of byGroup.values()) {
    const names = [...entry.names];
    for (let i = 0; i < names.length; i += 1) for (let j = i + 1; j < names.length; j += 1) {
      const key = pairKey(names[i], names[j]);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (entry.round === lastRound) lastPairs.add(key);
    }
  }
  return { counts, lastPairs, lastRound };
}

function targetSizes(total: number): number[] {
  if (total <= 0) return [];
  if (total <= 3) return [total];
  const threes = Math.floor(total / 3);
  const remainder = total % 3;
  if (remainder === 0) return Array(threes).fill(3);
  if (remainder === 1) return [...Array(Math.max(0, threes - 1)).fill(3), 2, 2];
  return [...Array(threes).fill(3), 2];
}

type Participant = { key: string; name: string; recordId: string; choiceIndex: number };

function stableRank(seed: string, key: string) {
  let hash = 2166136261;
  for (const char of `${seed}\u0000${key}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return hash;
}

function compareNumbers(left: number[], right: number[]) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function participantOrder(left: Participant, right: Participant, seed: string) {
  return stableRank(seed, left.key) - stableRank(seed, right.key)
    || left.key.localeCompare(right.key, "zh-CN");
}

function remainingConstraint(participant: Participant, remaining: Participant[], history: History) {
  let unseenPartners = 0;
  let recentPartners = 0;
  let totalRepeats = 0;
  for (const other of remaining) {
    if (other === participant) continue;
    const key = pairKey(participant.key, other.key);
    const count = history.counts.get(key) ?? 0;
    if (count === 0) unseenPartners += 1;
    if (history.lastPairs.has(key)) recentPartners += 1;
    totalRepeats += count;
  }
  return [unseenPartners, -recentPartners, -totalRepeats];
}

function candidateCost(group: Participant[], candidate: Participant, history: History) {
  let discussedPartners = 0;
  let recentPartners = 0;
  let totalRepeats = 0;
  for (const member of group) {
    const key = pairKey(member.key, candidate.key);
    const count = history.counts.get(key) ?? 0;
    if (count > 0) discussedPartners += 1;
    if (history.lastPairs.has(key)) recentPartners += 1;
    totalRepeats += count;
  }
  return [discussedPartners, recentPartners, totalRepeats];
}

function arrange(participants: Participant[], history: History, seed: string) {
  if (participants.length <= 1) return [participants];
  const sizes = targetSizes(participants.length);
  const remaining = [...participants];
  const groups: Participant[][] = [];

  for (const size of sizes) {
    remaining.sort((left, right) => (
      compareNumbers(
        remainingConstraint(left, remaining, history),
        remainingConstraint(right, remaining, history),
      ) || participantOrder(left, right, seed)
    ));
    const anchor = remaining.shift();
    if (!anchor) break;
    const group = [anchor];

    while (group.length < size) {
      remaining.sort((left, right) => (
        compareNumbers(candidateCost(group, left, history), candidateCost(group, right, history))
        || compareNumbers(
          remainingConstraint(left, remaining, history),
          remainingConstraint(right, remaining, history),
        )
        || participantOrder(left, right, seed)
      ));
      const candidate = remaining.shift();
      if (!candidate) break;
      group.push(candidate);
    }
    groups.push(group);
  }

  return groups;
}

export function makeGrouping(effective: Evaluation[], history: History, seed: string) {
  const books = new Map<string, { book: string; participants: Participant[] }>();
  for (const selection of effective) for (const { book, choiceIndex } of selection.choiceSlots) {
    const key = normalized(book);
    const entry = books.get(key) ?? { book, participants: [] };
    entry.participants.push({ key: selection.key, name: selection.name, recordId: selection.row.recordId ?? "", choiceIndex });
    books.set(key, entry);
  }
  const assignments = new Map<string, Record<string, string>>();
  const exportRows: { book: string; group: string; members: string[]; memberKeys: string[] }[] = [];
  for (const [bookKey, entry] of [...books].sort((a, b) => a[1].book.localeCompare(b[1].book, "zh-CN"))) {
    arrange(entry.participants, history, `${seed}:${bookKey}`).forEach((group, index) => {
      const groupNo = group.length === 1 ? "待协调" : String(index + 1);
      for (const participant of group) {
        const fields = assignments.get(participant.recordId) ?? {};
        fields[SELECTION_GROUP_FIELDS[participant.choiceIndex]] = groupNo;
        assignments.set(participant.recordId, fields);
      }
      exportRows.push({ book: entry.book, group: groupNo, members: group.map((item) => item.name), memberKeys: group.map((item) => item.key) });
    });
  }
  return { assignments, exportRows };
}

export function patchesForEvaluations(evaluations: Evaluation[], assignments: Map<string, Record<string, string>>) {
  return evaluations.filter((item) => item.row.recordId).map((item) => ({
    recordId: item.row.recordId as string,
    fields: {
      [SELECTION_STATUS_FIELD]: item.status,
      ...Object.fromEntries(SELECTION_GROUP_FIELDS.map((field) => [field, null])),
      ...(assignments.get(item.row.recordId as string) ?? {}),
    },
  }));
}
