import { z } from 'zod'
import type { Id } from '@/convex/_generated/dataModel'

export const PENDING_TIP_INTENT_STORAGE_KEY = 'quilltip:pendingTipIntent'

const amountFieldsSchema = z.object({
  amountCents: z.number().int().positive().optional(),
  customAmount: z.string().optional(),
})

const articlePendingTipIntentSchema = amountFieldsSchema.extend({
  kind: z.literal('article'),
  articleId: z.string(),
  message: z.string().max(500).optional(),
})

const highlightPendingTipIntentSchema = amountFieldsSchema.extend({
  kind: z.literal('highlight'),
  articleId: z.string(),
  articleSlug: z.string(),
  highlightText: z.string(),
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().nonnegative(),
  startContainerPath: z.string().optional(),
  endContainerPath: z.string().optional(),
})

export const pendingTipIntentSchema = z.discriminatedUnion('kind', [
  articlePendingTipIntentSchema,
  highlightPendingTipIntentSchema,
])

export type PendingTipIntent = z.infer<typeof pendingTipIntentSchema>
export type ArticlePendingTipIntent = z.infer<
  typeof articlePendingTipIntentSchema
>
export type HighlightPendingTipIntent = z.infer<
  typeof highlightPendingTipIntentSchema
>

/** Survives React remounts within the same tab (e.g. Suspense / client navigation). */
let memoryPendingTipIntent: PendingTipIntent | null = null

function normalizeArticleId(articleId: Id<'articles'> | string): string {
  return String(articleId)
}

function persistPendingTipJson(json: string): void {
  try {
    window.sessionStorage.setItem(PENDING_TIP_INTENT_STORAGE_KEY, json)
  } catch {
    // Quota or private mode
  }
  try {
    window.localStorage.setItem(PENDING_TIP_INTENT_STORAGE_KEY, json)
  } catch {
    // Quota or private mode
  }
}

function readPendingTipJson(): string | null {
  try {
    return (
      window.sessionStorage.getItem(PENDING_TIP_INTENT_STORAGE_KEY) ??
      window.localStorage.getItem(PENDING_TIP_INTENT_STORAGE_KEY)
    )
  } catch {
    return null
  }
}

function parsePendingTipJson(raw: string): PendingTipIntent | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    const result = pendingTipIntentSchema.safeParse(parsed)
    return result.success ? result.data : null
  } catch {
    return null
  }
}

export function writePendingTipIntent(intent: PendingTipIntent): void {
  if (typeof window === 'undefined') return
  const normalized: PendingTipIntent = {
    ...intent,
    articleId: normalizeArticleId(intent.articleId),
  }
  memoryPendingTipIntent = normalized
  persistPendingTipJson(JSON.stringify(normalized))
}

export function readPendingTipIntent(): PendingTipIntent | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = readPendingTipJson()
    if (raw !== null) {
      const parsed = parsePendingTipJson(raw)
      if (parsed) {
        memoryPendingTipIntent = parsed
        return parsed
      }
    }
  } catch {
    // Fall through to memory
  }
  return memoryPendingTipIntent
}

export function clearPendingTipIntent(): void {
  memoryPendingTipIntent = null
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(PENDING_TIP_INTENT_STORAGE_KEY)
  } catch {
    // Ignore
  }
  try {
    window.localStorage.removeItem(PENDING_TIP_INTENT_STORAGE_KEY)
  } catch {
    // Ignore
  }
}

export function matchesArticlePendingIntent(
  intent: PendingTipIntent | null,
  articleId: Id<'articles'>
): intent is ArticlePendingTipIntent {
  return (
    intent?.kind === 'article' &&
    intent.articleId === normalizeArticleId(articleId)
  )
}

export function matchesHighlightPendingIntent(
  intent: PendingTipIntent | null,
  articleId: Id<'articles'>
): intent is HighlightPendingTipIntent {
  return (
    intent?.kind === 'highlight' &&
    intent.articleId === normalizeArticleId(articleId)
  )
}
