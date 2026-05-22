import type { AppRouterInstance } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import { buildLoginHref } from '@/lib/auth/safeReturnPath'
import {
  writePendingTipIntent,
  type PendingTipIntent,
} from '@/lib/tip/pendingTipIntent'

export function redirectToLoginForTip(
  router: AppRouterInstance,
  returnPath: string,
  intent: PendingTipIntent
): void {
  writePendingTipIntent(intent)
  router.replace(buildLoginHref(returnPath))
}
