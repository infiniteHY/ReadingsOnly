// Allocate all odd-book triple seats together. Lexicographic min-cost flow makes
// current-round fairness a strict priority over any amount of historical cost.
export function allocateTripleSeats(books, tripleCounts = new Map(), seed = "") {
  const oddBooks = [...books].filter(([, entry]) => entry.participants.length >= 3 && entry.participants.length % 2 === 1)
    .sort(([a], [b]) => a.localeCompare(b));
  const keys = [...new Set(oddBooks.flatMap(([, entry]) => entry.participants.map((p) => p.key)))].sort();
  const source = 0;
  const sink = 1 + oddBooks.length + keys.length;
  const graph = Array.from({ length: sink + 1 }, () => []);
  const nodes = new Map(keys.map((key, index) => [key, 1 + oddBooks.length + index]));
  const edges = new Map();
  const degree = new Map();
  const add = (from, to, capacity, cost) => {
    const edge = { to, capacity, cost, reverse: graph[to].length };
    graph[from].push(edge);
    graph[to].push({ to: from, capacity: 0, cost: cost.map((n) => -n), reverse: graph[from].length - 1 });
    return edge;
  };
  const rank = (key) => {
    let hash = 2166136261;
    for (const char of `${seed}\u0000${key}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
    return hash;
  };
  oddBooks.forEach(([bookKey, entry], index) => {
    const node = index + 1;
    add(source, node, 3, [0, 0, 0]);
    const candidates = [...entry.participants].sort((a, b) => rank(`${bookKey}:${a.key}`) - rank(`${bookKey}:${b.key}`) || a.key.localeCompare(b.key));
    edges.set(bookKey, candidates.map((p) => {
      degree.set(p.key, (degree.get(p.key) ?? 0) + 1);
      return [p.key, add(node, nodes.get(p.key), 1, [0, 0, 0])];
    }));
  });
  for (const key of keys) {
    const count = tripleCounts.get(key) ?? 0;
    for (let seat = 0; seat < degree.get(key); seat += 1) {
      add(nodes.get(key), sink, 1, [seat, count > 0 ? 1 : 0, count]);
    }
  }
  const less = (a, b) => !b || a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])));
  for (let flow = 0; flow < oddBooks.length * 3; flow += 1) {
    const distances = Array(graph.length).fill(null);
    const previous = Array(graph.length).fill(null);
    distances[source] = [0, 0, 0];
    // Reverse edges allow earlier assignments to move to another book/person.
    for (let pass = 0; pass < graph.length - 1; pass += 1) {
      let changed = false;
      for (let from = 0; from < graph.length; from += 1) {
        if (!distances[from]) continue;
        graph[from].forEach((edge, index) => {
          if (!edge.capacity) return;
          const cost = edge.cost.map((n, i) => n + distances[from][i]);
          if (less(cost, distances[edge.to])) {
            distances[edge.to] = cost;
            previous[edge.to] = [from, index];
            changed = true;
          }
        });
      }
      if (!changed) break;
    }
    if (!previous[sink]) throw new Error("无法分配三人组名额");
    for (let to = sink; to !== source;) {
      const [from, index] = previous[to];
      const edge = graph[from][index];
      edge.capacity -= 1;
      graph[to][edge.reverse].capacity += 1;
      to = from;
    }
  }
  return new Map([...edges].map(([book, candidates]) => [book, new Set(candidates.filter(([, edge]) => edge.capacity === 0).map(([key]) => key))]));
}

export function tripleWarnings(groups) {
  const members = new Map();
  for (const group of groups) {
    if (group.members.length !== 3 || group.group === "待协调" || group.group === "0") continue;
    group.members.forEach((name, index) => {
      const key = group.memberKeys?.[index] ?? name;
      const entry = members.get(key) ?? { name, books: [] };
      entry.books.push(group.book);
      members.set(key, entry);
    });
  }
  return [...members.values()].filter((entry) => entry.books.length > 1)
    .map(({ name, books }) => `${name} 本期在 ${books.length} 本书中进入三人组：${books.join("、")}。可手动调整或设为读书笔记组。`);
}
