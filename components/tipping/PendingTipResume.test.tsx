/** @vitest-environment jsdom */
import { act, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const HighlightTipButtonSpy = vi.fn((_props: unknown) => null)

vi.mock('@/components/highlights/HighlightTipButton', () => ({
  HighlightTipButton: (props: unknown) => {
    HighlightTipButtonSpy(props)
    return null
  },
}))

vi.mock('@/components/providers/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: true, isLoading: false }),
}))

vi.mock('@/lib/tip/pendingTipIntent', () => ({
  matchesHighlightPendingIntent: () => true,
  readPendingTipIntent: () => ({
    kind: 'highlight',
    articleId: 'articles:123',
    articleSlug: 'my-article',
    highlightText: 'Selected highlight text',
    startOffset: 10,
    endOffset: 20,
    amountCents: 500,
  }),
  clearPendingTipIntent: vi.fn(),
}))

import { PendingTipResume } from '@/components/tipping/PendingTipResume'

describe('PendingTipResume', () => {
  it('reopens highlight tip with restored amount', async () => {
    await act(async () => {
      render(
        <PendingTipResume
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          articleId={'articles:123' as any}
          articleSlug="my-article"
          authorName="Author"
          authorStellarAddress="GABC"
        />
      )
      await new Promise((r) => setTimeout(r, 150))
    })

    expect(HighlightTipButtonSpy).toHaveBeenCalledTimes(1)
    const props = HighlightTipButtonSpy.mock.calls[0]![0] as {
      resumeOpen?: boolean
      resumeAmountCents?: number
      highlightText?: string
      onResumeOpenChange?: (open: boolean) => void
    }
    expect(props.resumeOpen).toBe(true)
    expect(props.resumeAmountCents).toBe(500)
    expect(props.highlightText).toBe('Selected highlight text')
    expect(props.onResumeOpenChange).toBeTypeOf('function')
  })
})
