import type { PendingTipIntent } from '@/lib/tip/pendingTipIntent'

export function shouldUseFullPageAuthNavigation(
  returnPath: string,
  pendingTipIntent: PendingTipIntent | null
): boolean {
  return (
    returnPath.includes('resumeArticleTip=1') ||
    pendingTipIntent?.kind === 'highlight'
  )
}
