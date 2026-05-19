/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/react'
import {
  DRAFT_BACKUP_STORAGE_KEY,
  backupMatchesSession,
  clearDraftBackup,
  hasMeaningfulBackupContent,
  readDraftBackup,
  shouldOfferDraftRecovery,
  shouldPersistDraftBackup,
  writeDraftBackup,
  type DraftBackup,
} from './draftBackup'

const EMPTY_DOC: JSONContent = { type: 'doc', content: [] }

const sampleContent: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Recovery test body' }],
    },
  ],
}

function makeBackup(overrides: Partial<DraftBackup> = {}): DraftBackup {
  return {
    title: 'My draft',
    content: sampleContent,
    savedAt: Date.now(),
    ...overrides,
  }
}

describe('draftBackup', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('reads and writes a valid backup', () => {
    const backup = makeBackup({ savedAt: 1_700_000_000_000 })
    writeDraftBackup(backup)
    expect(readDraftBackup()).toEqual(backup)
  })

  it('returns null for malformed backup JSON', () => {
    localStorage.setItem(DRAFT_BACKUP_STORAGE_KEY, '{"title":123}')
    expect(readDraftBackup()).toBeNull()
  })

  it('clears backup only when clearDraftBackup is called', () => {
    writeDraftBackup(makeBackup())
    expect(readDraftBackup()).not.toBeNull()
    clearDraftBackup()
    expect(readDraftBackup()).toBeNull()
  })

  describe('shouldPersistDraftBackup', () => {
    it('returns false when there are no unsaved changes (synced draft)', () => {
      expect(
        shouldPersistDraftBackup(true, false, true, true)
      ).toBe(false)
    })

    it('returns true when there are unsaved changes and content', () => {
      expect(
        shouldPersistDraftBackup(true, true, true, false)
      ).toBe(true)
    })
  })

  describe('hasMeaningfulBackupContent', () => {
    it('returns false for empty doc and default title', () => {
      expect(
        hasMeaningfulBackupContent(
          makeBackup({ title: 'Untitled', content: EMPTY_DOC })
        )
      ).toBe(false)
    })

    it('returns true when body has text', () => {
      expect(hasMeaningfulBackupContent(makeBackup())).toBe(true)
    })

    it('returns true when only metadata is set', () => {
      expect(
        hasMeaningfulBackupContent(
          makeBackup({
            title: 'Untitled',
            content: EMPTY_DOC,
            excerpt: 'Short summary',
          })
        )
      ).toBe(true)
    })
  })

  describe('backupMatchesSession', () => {
    it('matches two new-draft sessions', () => {
      expect(
        backupMatchesSession(makeBackup(), {
          urlArticleId: undefined,
          stateArticleId: undefined,
        })
      ).toBe(true)
    })

    it('matches when URL id equals backup articleId', () => {
      expect(
        backupMatchesSession(makeBackup({ articleId: 'art-1' }), {
          urlArticleId: 'art-1',
          stateArticleId: undefined,
        })
      ).toBe(true)
    })

    it('does not match when URL id differs from backup articleId', () => {
      expect(
        backupMatchesSession(makeBackup({ articleId: 'art-1' }), {
          urlArticleId: 'art-2',
          stateArticleId: undefined,
        })
      ).toBe(false)
    })

    it('matches backup with articleId when URL has no id yet', () => {
      expect(
        backupMatchesSession(makeBackup({ articleId: 'art-1' }), {
          urlArticleId: undefined,
          stateArticleId: undefined,
        })
      ).toBe(true)
    })
  })

  describe('shouldOfferDraftRecovery', () => {
    it('offers recovery when backup is newer than server draft', () => {
      const backup = makeBackup({
        articleId: 'art-1',
        savedAt: 2_000,
      })
      const server = {
        title: 'My draft',
        content: sampleContent,
        updatedAt: 1_000,
      }
      expect(
        shouldOfferDraftRecovery(backup, server, {
          urlArticleId: 'art-1',
        })
      ).toBe(true)
    })

    it('does not offer recovery when snapshots match and backup is not newer', () => {
      const backup = makeBackup({
        articleId: 'art-1',
        savedAt: 1_000,
      })
      const server = {
        title: 'My draft',
        content: sampleContent,
        updatedAt: 2_000,
      }
      expect(
        shouldOfferDraftRecovery(backup, server, {
          urlArticleId: 'art-1',
        })
      ).toBe(false)
    })

    it('offers recovery when content differs from server', () => {
      const backup = makeBackup({
        articleId: 'art-1',
        savedAt: 1_000,
      })
      const server = {
        title: 'My draft',
        content: EMPTY_DOC,
        updatedAt: 9_000,
      }
      expect(
        shouldOfferDraftRecovery(backup, server, {
          urlArticleId: 'art-1',
        })
      ).toBe(true)
    })

    it('does not offer recovery for empty backup', () => {
      expect(
        shouldOfferDraftRecovery(
          makeBackup({ title: 'Untitled', content: EMPTY_DOC }),
          undefined,
          {}
        )
      ).toBe(false)
    })

    it('does not offer recovery when session does not match', () => {
      expect(
        shouldOfferDraftRecovery(
          makeBackup({ articleId: 'art-1' }),
          undefined,
          { urlArticleId: 'art-2' }
        )
      ).toBe(false)
    })

    it('offers recovery for meaningful backup with no server draft', () => {
      expect(shouldOfferDraftRecovery(makeBackup(), undefined, {})).toBe(true)
    })
  })
})
