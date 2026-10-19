/** @vitest-environment jsdom */
import { beforeEach, it, expect } from 'vitest'
import {
  savePracticeStatus,
  clearPracticeRecord,
  withPracticeLock,
} from './practice-storage'
import { PENDING_KEY, type PracticeRecord } from './practice'
const old: PracticeRecord = {
  hash: 'a'.repeat(64),
  address: 'GCS5XCIKIBZ3L5CUKJMMAG6IUBBNCCPT5SFTXFW5I4DZOMT4RJ43DUAR',
  expires: 2000,
  status: 'unknown',
}
const newer = { ...old, hash: 'b'.repeat(64) }
beforeEach(() => localStorage.clear())
it('does not let an old tab overwrite or delete a newer recovery record', () => {
  localStorage.setItem(PENDING_KEY, JSON.stringify(newer))
  expect(savePracticeStatus({ ...old, status: 'failed' })).toBe(false)
  expect(clearPracticeRecord(old.hash)).toBe(false)
  expect(JSON.parse(localStorage.getItem(PENDING_KEY)!)).toEqual(newer)
  expect(clearPracticeRecord(newer.hash)).toBe(true)
})
it('prevents a second browser context from entering approval while the first holds the lock', async () => {
  let held = false
  const locks = {
    request: async (
      _name: string,
      _options: unknown,
      callback: (lock: unknown) => Promise<void>
    ) => {
      if (held) return callback(null)
      held = true
      try {
        await callback({})
      } finally {
        held = false
      }
    },
  }
  let release: () => void = () => {}
  const first = withPracticeLock(
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      }),
    locks
  )
  await expect(
    withPracticeLock(async () => {
      throw new Error('Must not enter')
    }, locks)
  ).rejects.toThrow(/another tab/i)
  release()
  await first
})
