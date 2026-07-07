/**
 * Guard-option parsing. Safety guards must FAIL SAFE on a bad config value:
 * a typo in hand-edited accounts.json ("ten", "10%") must not silently
 * disable the guard (Number(...) → NaN compares false against everything)
 * and must not throw and brick account bootstrap. Instead: warn loudly and
 * keep the guard ACTIVE at its default limit.
 */
export function positiveNumberOption(
  options: Record<string, unknown>,
  key: string,
  fallback: number,
  guardName: string,
): number {
  const raw = options[key]
  if (raw == null) return fallback
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) {
    console.warn(
      `guard ${guardName}: option ${key}=${JSON.stringify(raw)} is not a positive number — ` +
      `falling back to the default ${fallback} so the guard stays active`,
    )
    return fallback
  }
  return n
}
