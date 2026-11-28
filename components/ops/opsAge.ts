/** "4 min", "3 h", "2 d": the age of an ops record, rounded down. */
export function formatAge(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return 'under 1 min'
  if (minutes < 120) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours} h`
  return `${Math.floor(hours / 24)} d`
}

/** Public runbook, on the default branch. */
export const RUNBOOK_URL =
  'https://github.com/pragya-shar/QuillTip/blob/main/docs/operations/chain-runbook.md'
