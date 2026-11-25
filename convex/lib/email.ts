// Normalizes an email for storage and lookup. Returns null when the value is
// not a plausible address. Kept deliberately simple; delivery proves it.
export function normalizeEmail(value: string): string | null {
  const email = value.trim().toLowerCase()
  if (email.length < 3 || email.length > 254) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null
  return email
}
