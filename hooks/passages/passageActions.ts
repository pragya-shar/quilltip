/**
 * What a reader can do with a line they marked, apart from tipping it:
 * keep it (a free highlight, on their Shelf), remove it with an Undo,
 * restore it, appreciate another reader's line, and note it. Extracted from
 * the legacy highlight panel; plain functions over the mutations, so the
 * rules are tested without React or Convex.
 */
import type { Passage } from '@/hooks/read/passageOffsets'

export type PassageMutations<Id> = {
  create(args: {
    articleId: string
    text: string
    startOffset: number
    endOffset: number
    startContainerPath: string
    endContainerPath: string
    note?: string
    isPublic?: boolean
  }): Promise<Id>
  remove(args: { id: Id }): Promise<unknown>
  restore(args: { id: Id }): Promise<unknown>
  appreciate(args: { id: Id; appreciated: boolean }): Promise<unknown>
  update(args: { id: Id; note?: string }): Promise<unknown>
}

export type PassageNotice = {
  title: string
  tone: 'done' | 'failure' | 'info'
  action?: { label: string; onAction: () => void }
}

export const PASSAGE_COPY = {
  kept: 'Kept on your Shelf.',
  removed: 'Line removed.',
  restored: 'Line restored.',
  undo: 'Undo',
  restoreFailed: 'Could not restore your line.',
  retry: 'Try again',
  failed: 'That did not save. Try again.',
} as const

export function passageActions<Id>(
  m: PassageMutations<Id>,
  notify: (notice: PassageNotice) => void,
  {
    quiet = false,
  }: {
    /**
     * Say failures only: for a control whose own state confirms the
     * change (a Keep toggle shows Kept; pressing it again is the undo).
     */
    quiet?: boolean
  } = {}
) {
  const succeeded = (notice: PassageNotice) => {
    if (!quiet) notify(notice)
  }
  /** Runs a change; a failure is said once. A mutation may answer null. */
  const attempt = async <T>(
    change: () => Promise<T>
  ): Promise<{ ok: true; value: T } | { ok: false }> => {
    try {
      return { ok: true, value: await change() }
    } catch {
      notify({ title: PASSAGE_COPY.failed, tone: 'failure' })
      return { ok: false }
    }
  }

  const restore = async (id: Id): Promise<boolean> => {
    try {
      await m.restore({ id })
      notify({ title: PASSAGE_COPY.restored, tone: 'done' })
      return true
    } catch {
      notify({
        title: PASSAGE_COPY.restoreFailed,
        tone: 'failure',
        action: { label: PASSAGE_COPY.retry, onAction: () => void restore(id) },
      })
      return false
    }
  }

  return {
    /** Keeps a line as a private highlight. Returns its id, or null. */
    keep: async (articleId: string, passage: Passage, note?: string) => {
      const result = await attempt(() =>
        m.create({
          articleId,
          text: passage.text,
          startOffset: passage.startOffset,
          endOffset: passage.endOffset,
          startContainerPath: passage.startContainerPath,
          endContainerPath: passage.endContainerPath,
          note,
          isPublic: false,
        })
      )
      if (!result.ok) return null
      succeeded({ title: PASSAGE_COPY.kept, tone: 'done' })
      return result.value
    },
    /** Removes a kept line, with an Undo that restores it. */
    remove: async (id: Id): Promise<boolean> => {
      if (!(await attempt(() => m.remove({ id }))).ok) return false
      succeeded({
        title: PASSAGE_COPY.removed,
        tone: 'info',
        action: { label: PASSAGE_COPY.undo, onAction: () => void restore(id) },
      })
      return true
    },
    restore,
    appreciate: async (id: Id, appreciated: boolean) =>
      (await attempt(() => m.appreciate({ id, appreciated }))).ok,
    saveNote: async (id: Id, note: string) =>
      (await attempt(() => m.update({ id, note: note.trim() }))).ok,
  }
}
