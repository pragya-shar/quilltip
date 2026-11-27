import { describe, expect, it } from 'vitest'
import {
  noteSeenKeyIds,
  readPendingOperation,
  seenKeyIds,
  writePendingOperation,
  type NoteStorage,
} from '../../lib/tab-ui/device-memory'

function memory(): NoteStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  }
}

describe('seen key ids', () => {
  it('accumulates ids per tab and reader', () => {
    const s = memory()
    noteSeenKeyIds('T', 'R', [2, 1], s)
    noteSeenKeyIds('T', 'R', [2, 5], s)
    noteSeenKeyIds('T', 'other', [9], s)
    expect(seenKeyIds('T', 'R', s)).toEqual([1, 2, 5])
    expect(seenKeyIds('T', 'other', s)).toEqual([9])
  })
  it('reads nothing from broken or missing storage', () => {
    const s = memory()
    s.setItem('quilltip-tab-seen-keys:T|R', '{not json')
    expect(seenKeyIds('T', 'R', s)).toEqual([])
    expect(seenKeyIds('T', 'R', null)).toEqual([])
    const throwing: NoteStorage = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {},
    }
    expect(() => noteSeenKeyIds('T', 'R', [1], throwing)).not.toThrow()
  })
})

describe('pending operation', () => {
  it('stores, reads and clears the operation in flight', () => {
    const s = memory()
    const op = {
      flow: 'tab-top-up' as const,
      reader: 'R',
      before: '1',
      maxTime: 10,
      startedAt: 1,
    }
    writePendingOperation(op, s)
    expect(readPendingOperation(s)).toEqual(op)
    writePendingOperation(null, s)
    expect(readPendingOperation(s)).toBeNull()
  })
})
