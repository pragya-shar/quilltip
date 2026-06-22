import type { Id } from '@/convex/_generated/dataModel'
import type { ArticlePendingTipIntent } from '@/lib/tip/pendingTipIntent'

export const RESUME_ARTICLE_TIP_PARAM = 'resumeArticleTip'
export const TIP_CENTS_PARAM = 'tipCents'
export const TIP_CUSTOM_PARAM = 'tipCustom'
export const TIP_MSG_PARAM = 'tipMsg'

const MAX_URL_MESSAGE_LENGTH = 200

export function appendArticleTipResumeToReturnPath(
  returnPath: string,
  intent: ArticlePendingTipIntent
): string {
  const questionIndex = returnPath.indexOf('?')
  const pathname =
    questionIndex === -1 ? returnPath : returnPath.slice(0, questionIndex)
  const params = new URLSearchParams(
    questionIndex === -1 ? '' : returnPath.slice(questionIndex + 1)
  )

  params.set(RESUME_ARTICLE_TIP_PARAM, '1')
  if (intent.amountCents != null) {
    params.set(TIP_CENTS_PARAM, String(intent.amountCents))
  }
  if (intent.customAmount) {
    params.set(TIP_CUSTOM_PARAM, intent.customAmount)
  }
  if (intent.message) {
    params.set(TIP_MSG_PARAM, intent.message.slice(0, MAX_URL_MESSAGE_LENGTH))
  }

  const qs = params.toString()
  return qs ? `${pathname}?${qs}` : pathname
}

export function hasArticleTipResumeFlag(
  searchParams: URLSearchParams
): boolean {
  return searchParams.get(RESUME_ARTICLE_TIP_PARAM) === '1'
}

export function parseArticleTipResumeFromSearchParams(
  searchParams: URLSearchParams,
  articleId: Id<'articles'>
): ArticlePendingTipIntent | null {
  if (!hasArticleTipResumeFlag(searchParams)) return null

  const centsRaw = searchParams.get(TIP_CENTS_PARAM)
  const amountCents =
    centsRaw !== null ? Number.parseInt(centsRaw, 10) : undefined
  const customAmount = searchParams.get(TIP_CUSTOM_PARAM) ?? undefined
  const message = searchParams.get(TIP_MSG_PARAM) ?? undefined

  if (
    amountCents !== undefined &&
    (!Number.isFinite(amountCents) || amountCents <= 0)
  ) {
    return {
      kind: 'article',
      articleId: String(articleId),
      ...(customAmount ? { customAmount } : {}),
      ...(message ? { message } : {}),
    }
  }

  return {
    kind: 'article',
    articleId: String(articleId),
    ...(amountCents !== undefined ? { amountCents } : {}),
    ...(customAmount ? { customAmount } : {}),
    ...(message ? { message } : {}),
  }
}
