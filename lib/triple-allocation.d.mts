export function allocateTripleSeats(
  books: Map<string, { participants: { key: string }[] }>,
  tripleCounts?: Map<string, number>,
  seed?: string,
): Map<string, Set<string>>;
export function tripleWarnings(groups: { book: string; group: string; members: string[]; memberKeys?: string[] }[]): string[];
