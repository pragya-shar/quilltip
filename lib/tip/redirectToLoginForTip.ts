import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import { buildLoginHref } from '@/lib/auth/safeReturnPath'
import { appendArticleTipResumeToReturnPath } from '@/lib/tip/articleTipResumeUrl'
import {
  writePendingTipIntent,
  type ArticlePendingTipIntent,
  type PendingTipIntent,
} from '@/lib/tip/pendingTipIntent'

export function redirectToLoginForTip(
  router: AppRouterInstance,
  returnPath: string,
  intent: PendingTipIntent
): void {
  writePendingTipIntent(intent)

  const returnWithResume =
    intent.kind === 'article'
      ? appendArticleTipResumeToReturnPath(
          returnPath,
          intent as ArticlePendingTipIntent
        )
      : returnPath

  router.replace(buildLoginHref(returnWithResume))
}
