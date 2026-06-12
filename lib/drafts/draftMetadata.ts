import { extractTextFromTiptapJson } from '@/lib/tiptap/extractTextFromTiptapJson'
import { countWords } from '@/lib/reading-time'

export type DraftSortKey = 'updatedAt' | 'createdAt'

export type DraftLike = {
  _id: string
  _creationTime: number
  updatedAt: number
  content?: unknown
}

export function getWordCountFromContent(content: unknown): number {
  const text = extractTextFromTiptapJson(content).trim()
  if (!text) return 0
  return countWords(text)
}

export function sortDraftsBy<T extends DraftLike>(
  drafts: T[],
  key: DraftSortKey
): T[] {
  return [...drafts].sort((a, b) => {
    const aTime = key === 'updatedAt' ? a.updatedAt : a._creationTime
    const bTime = key === 'updatedAt' ? b.updatedAt : b._creationTime
    return bTime - aTime
  })
}

export function getMostRecentDraft<T extends DraftLike>(drafts: T[]): T | null {
  if (drafts.length === 0) return null
  return sortDraftsBy(drafts, 'updatedAt')[0] ?? null
}

export function formatWordCount(count: number): string {
  if (count === 0) return 'No content yet'
  if (count === 1) return '1 word'
  return `${count.toLocaleString()} words`
}
