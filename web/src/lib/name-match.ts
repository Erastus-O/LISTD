/**
 * Shared comparison for type-to-sign flows (tenant report signing, client
 * report sign-off, clerk inspection sign-off, onboarding terms signature).
 * Case-insensitive and whitespace-tolerant: "  john   SMITH " matches
 * "John Smith". An empty `expected` never matches — callers decide what to
 * do when there is no name on file to compare against.
 */
export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

export function namesMatch(typed: string, expected: string): boolean {
  const want = normalizeName(expected)
  return want.length > 0 && normalizeName(typed) === want
}
