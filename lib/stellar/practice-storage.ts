import {
  PENDING_KEY,
  parsePracticeRecord,
  type PracticeRecord,
} from './practice'
/** Compare identity before every update: an older tab cannot replace a newer receipt. */
export function savePracticeStatus(record: PracticeRecord): boolean {
  if (
    parsePracticeRecord(localStorage.getItem(PENDING_KEY))?.hash !== record.hash
  )
    return false
  localStorage.setItem(PENDING_KEY, JSON.stringify(record))
  return true
}
export function clearPracticeRecord(hash: string): boolean {
  if (parsePracticeRecord(localStorage.getItem(PENDING_KEY))?.hash !== hash)
    return false
  localStorage.removeItem(PENDING_KEY)
  return true
}
type PracticeLocks = {
  request: (
    name: string,
    options: { ifAvailable: true },
    callback: (lock: unknown) => Promise<void>
  ) => Promise<void>
}
export async function withPracticeLock(
  task: () => Promise<void>,
  locks: PracticeLocks | undefined = navigator.locks
): Promise<void> {
  if (!locks)
    throw new Error(
      'This browser cannot safely coordinate wallet practice. Please use an up-to-date browser.'
    )
  await locks.request(
    'quilltip-wallet-practice',
    { ifAvailable: true },
    async (lock) => {
      if (!lock)
        throw new Error(
          'Wallet practice is already open for approval in another tab. Finish that attempt first.'
        )
      await task()
    }
  )
}
