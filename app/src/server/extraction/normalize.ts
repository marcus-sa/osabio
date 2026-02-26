export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isFuzzyNameMatch(a: string, b: string): boolean {
  if (a.length === 0 || b.length === 0) {
    return false;
  }

  if (a === b) {
    return true;
  }

  return a.includes(b) || b.includes(a);
}
