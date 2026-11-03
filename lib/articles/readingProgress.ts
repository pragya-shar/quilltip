const key = 'quilltip:reading-progress:v1'
const limit = 20

export type ReadingPosition = { id: string; ratio: number; offset: number }

export function readReadingProgress(): ReadingPosition[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
    if (!Array.isArray(value)) return []
    return value
      .filter(
        (entry): entry is ReadingPosition =>
          entry &&
          typeof entry.id === 'string' &&
          Number.isFinite(entry.ratio) &&
          entry.ratio > 0.03 &&
          entry.ratio < 0.95 &&
          Number.isFinite(entry.offset) &&
          entry.offset >= 0 &&
          entry.offset <= 1
      )
      .slice(0, limit)
  } catch {
    return []
  }
}

export function saveReadingProgress(entry: ReadingPosition) {
  try {
    const entries = readReadingProgress().filter(({ id }) => id !== entry.id)
    if (entry.ratio > 0.03 && entry.ratio < 0.95) entries.unshift(entry)
    localStorage.setItem(key, JSON.stringify(entries.slice(0, limit)))
  } catch {
    // Reading remains available when browser storage is blocked.
  }
}
