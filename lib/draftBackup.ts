import type { JSONContent } from '@tiptap/react'
import { z } from 'zod'

export const DRAFT_BACKUP_STORAGE_KEY = 'quilltip_draft_backup'

const jsonContentSchema: z.ZodType<JSONContent> = z
  .object({
    type: z.string(),
  })
  .passthrough()

export const draftBackupSchema = z.object({
  title: z.string(),
  content: jsonContentSchema,
  excerpt: z.string().optional(),
  tags: z.array(z.string()).optional(),
  coverImage: z.string().optional(),
  writerNotes: z.string().optional(),
  articleId: z.string().optional(),
  savedAt: z.number(),
})

export type DraftBackup = z.infer<typeof draftBackupSchema>

export type ServerDraftSnapshot = {
  title: string
  content?: JSONContent | null
  excerpt?: string
  tags?: string[]
  coverImage?: string
  writerNotes?: string
  updatedAt: number
}

export type BackupSessionContext = {
  urlArticleId?: string
  stateArticleId?: string
}

type DraftSnapshotFields = {
  title: string
  content: JSONContent
  excerpt?: string
  tags?: string[]
  coverImage?: string
  writerNotes?: string
}

function normalizeSnapshot(fields: DraftSnapshotFields): string {
  return JSON.stringify({
    title: fields.title.trim() || 'Untitled',
    content: fields.content,
    excerpt: (fields.excerpt ?? '').trim(),
    tags: [...(fields.tags ?? [])].sort(),
    coverImage: (fields.coverImage ?? '').trim(),
    writerNotes: (fields.writerNotes ?? '').trim(),
  })
}

function isEmptyDoc(doc: JSONContent): boolean {
  const nodes = doc.content
  if (!nodes || nodes.length === 0) return true
  if (nodes.length === 1 && nodes[0]?.type === 'paragraph') {
    const paragraph = nodes[0]
    const inline = paragraph.content
    if (!inline || inline.length === 0) return true
    return inline.every(
      (node) =>
        node.type === 'text' &&
        typeof node.text === 'string' &&
        node.text.trim() === ''
    )
  }
  return false
}

export function shouldPersistDraftBackup(
  isAuthenticated: boolean,
  hasUnsavedChanges: boolean,
  hasContent: boolean,
  hasMetadata: boolean
): boolean {
  return isAuthenticated && hasUnsavedChanges && (hasContent || hasMetadata)
}

export function hasMeaningfulBackupContent(backup: DraftBackup): boolean {
  const hasCustomTitle =
    backup.title.trim() !== '' && backup.title.trim() !== 'Untitled'
  const hasCover = !!backup.coverImage?.trim()
  const hasExcerpt = !!backup.excerpt?.trim()
  const hasTags = (backup.tags?.length ?? 0) > 0
  const hasWriterNotes = !!backup.writerNotes?.trim()
  if (hasCustomTitle || hasCover || hasExcerpt || hasTags || hasWriterNotes)
    return true
  return !isEmptyDoc(backup.content)
}

export function backupMatchesSession(
  backup: DraftBackup,
  { urlArticleId, stateArticleId }: BackupSessionContext
): boolean {
  const sessionId = urlArticleId ?? stateArticleId
  const backupId = backup.articleId

  if (!sessionId && !backupId) return true
  if (sessionId && backupId) return sessionId === backupId
  if (!sessionId && backupId) return true
  return false
}

function snapshotsEqual(
  backup: DraftBackup,
  server: ServerDraftSnapshot
): boolean {
  return (
    normalizeSnapshot({
      title: backup.title,
      content: backup.content,
      excerpt: backup.excerpt,
      tags: backup.tags,
      coverImage: backup.coverImage,
      writerNotes: backup.writerNotes,
    }) ===
    normalizeSnapshot({
      title: server.title,
      content: server.content ?? { type: 'doc', content: [] },
      excerpt: server.excerpt,
      tags: server.tags,
      coverImage: server.coverImage,
      writerNotes: server.writerNotes,
    })
  )
}

export function shouldOfferDraftRecovery(
  backup: DraftBackup,
  serverDraft: ServerDraftSnapshot | null | undefined,
  session: BackupSessionContext
): boolean {
  if (!hasMeaningfulBackupContent(backup)) return false
  if (!backupMatchesSession(backup, session)) return false

  if (!serverDraft) return true

  if (snapshotsEqual(backup, serverDraft)) {
    return backup.savedAt > serverDraft.updatedAt
  }

  return true
}

export function readDraftBackup(): DraftBackup | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(DRAFT_BACKUP_STORAGE_KEY)
    if (!raw) return null
    const parsed = draftBackupSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function writeDraftBackup(backup: DraftBackup): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(DRAFT_BACKUP_STORAGE_KEY, JSON.stringify(backup))
  } catch {
    // localStorage unavailable or full
  }
}

export function clearDraftBackup(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(DRAFT_BACKUP_STORAGE_KEY)
  } catch {
    // localStorage unavailable
  }
}

export function formatBackupSavedAt(savedAt: number): string {
  const diffMs = Math.max(0, Date.now() - savedAt)
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return 'Saved locally just now'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) {
    return `Saved locally ${diffMin} minute${diffMin === 1 ? '' : 's'} ago`
  }
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) {
    return `Saved locally ${diffHr} hour${diffHr === 1 ? '' : 's'} ago`
  }
  const diffDay = Math.floor(diffHr / 24)
  return `Saved locally ${diffDay} day${diffDay === 1 ? '' : 's'} ago`
}
