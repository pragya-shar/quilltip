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

export function writePendingTipIntent(intent: PendingTipIntent): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(
      PENDING_TIP_INTENT_STORAGE_KEY,
      JSON.stringify(intent)
    )
  } catch {
    // Quota or private mode
  }
}

export function readPendingTipIntent(): PendingTipIntent | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(PENDING_TIP_INTENT_STORAGE_KEY)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    const result = pendingTipIntentSchema.safeParse(parsed)
    return result.success ? result.data : null
  } catch {
    return null
  }
}

export function clearPendingTipIntent(): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(PENDING_TIP_INTENT_STORAGE_KEY)
  } catch {
    // Ignore
  }
}

export function matchesArticlePendingIntent(
  intent: PendingTipIntent | null,
  articleId: Id<'articles'>
): intent is ArticlePendingTipIntent {
  return intent?.kind === 'article' && intent.articleId === articleId
}

export function matchesHighlightPendingIntent(
  intent: PendingTipIntent | null,
  articleId: Id<'articles'>
): intent is HighlightPendingTipIntent {
  return intent?.kind === 'highlight' && intent.articleId === articleId
}
