'use client'

import { TIP_DIALOG } from '@/lib/copy/tip-flow'

interface LastTipLineProps {
  uiState: string
  onView: () => void
}

const TEXT: Record<string, string> = {
  checking: TIP_DIALOG.checkingLast,
  confirmed: 'Your last tip is confirmed.',
  mismatch_author:
    'Your last tip went to the article’s updated payout address.',
  mismatch_review: 'Your last tip is under review.',
  failed: 'Your last tip was not sent.',
  expired: 'Your last tip timed out.',
}

/** One line under the tip button about a tip started earlier in this browser. */
export function LastTipLine({ uiState, onView }: LastTipLineProps) {
  return (
    <p className="tip-v2-last">
      <span>{TEXT[uiState] ?? TIP_DIALOG.checkingLast}</span>{' '}
      <button type="button" onClick={onView} className="tip-v2-link">
        {TIP_DIALOG.viewLast}
        <span className="sr-only"> your last tip</span>
      </button>
    </p>
  )
}
