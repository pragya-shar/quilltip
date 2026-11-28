'use client'

/**
 * Quick tip from the tab: one hook for the tip UI (issue #448 mounts it).
 * It signs a voucher with this browser's session key, with no wallet
 * prompt, submits it, and follows the receipt from accepted to settled.
 *
 *   const tip = useTabTip({ articleId, highlight, recipientCount })
 *   tip.availability // can this reader tip from the tab here, and if not, why
 *   await tip.send(25) // US cents; Convex converts at its cached price
 *   tip.progress      // a `ProgressSource` for `TransactionProgress`
 *
 * The client never decides a tip is settled: the receipt status from
 * `tabActivity.getMyTabTips` does.
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import { refusalFromTabError, type TabRefusal } from '@/lib/payments/failures'
import type { ProgressSource } from '@/lib/payments/ui-state'
import { commitAcceptedTip, signTabTip } from '@/lib/stellar/v2/tab'
import {
  tabTipAvailability,
  type TabTipAvailability,
} from '@/lib/tab-ui/tip-availability'
import {
  runTabTip,
  type TabTipOutcome,
  type TabTipStep,
} from '@/lib/tab-ui/tip-flow'
import type { TabTipHighlight } from '@/lib/tab-ui/types'
import { useTabServices } from './TabServicesContext'
import { useReaderTab, type ReaderTab } from './useReaderTab'

export type { TabTipAvailability }

function availabilityOf(
  reader: ReaderTab,
  target: Pick<TabTipTarget, 'recipientCount'>
): TabTipAvailability {
  return tabTipAvailability({
    status: reader.status,
    access: reader.access,
    device: reader.device.view,
    tab: reader.tab,
    settlement: reader.tabSettlement,
    recipientCount: target.recipientCount,
  })
}

export type TabTipTarget = {
  /** The article's Convex id. */
  articleId: string
  /** A highlight tip carries the passage. */
  highlight?: TabTipHighlight | null
  /**
   * Recipients Core pays for this article (`tipsV2.getTipEligibility`).
   * Tab tips pay one writer, so an article with co-author splits (more than
   * one recipient) cannot take them.
   */
  recipientCount?: number | null
}

export type TabTipState =
  | { phase: 'idle' }
  | { phase: 'running'; step: TabTipStep }
  | { phase: 'done'; outcome: TabTipOutcome }

export function useTabTip(target: TabTipTarget) {
  const services = useTabServices()
  const reader = useReaderTab(services)
  const availability = availabilityOf(reader, target)
  const [state, setState] = useState<TabTipState>({ phase: 'idle' })
  const busy = useRef(false)
  const readerRef = useRef(reader)
  readerRef.current = reader

  const send = useCallback(
    async (amountCents: number) => {
      const current = availabilityOf(readerRef.current, target)
      if (busy.current || current.kind !== 'ready') return null
      const address = readerRef.current.access.address!
      busy.current = true
      setState({ phase: 'running', step: 'preparing' })
      try {
        const signing = services.signingDeps(address)
        const outcome = await runTabTip(
          {
            prepareTip: services.prepareTip,
            submitTip: services.submitTip,
            sign: (prepared) => signTabTip(prepared, signing),
            commit: async (accepted) => {
              await commitAcceptedTip(accepted, signing)
            },
            newRequestId: services.newRequestId,
            onStep: (step) => setState({ phase: 'running', step }),
          },
          {
            articleId: target.articleId,
            amountCents,
            keyId: current.keyId,
            highlight: target.highlight ?? null,
          }
        )
        setState({ phase: 'done', outcome })
        if (outcome.kind === 'stopped') void readerRef.current.device.refresh()
        return outcome
      } finally {
        busy.current = false
      }
    },
    [services, target]
  )

  const reset = useCallback(() => setState({ phase: 'idle' }), [])

  const outcome = state.phase === 'done' ? state.outcome : null
  const receipt = useMemo(() => {
    if (outcome?.kind !== 'accepted') return null
    return (
      reader.activity?.tips.find((t) => t.receiptId === outcome.receiptId) ??
      null
    )
  }, [outcome, reader.activity])
  const receiptStatus =
    outcome?.kind === 'accepted' ? (receipt?.status ?? 'ACCEPTED') : null
  /** The settlement transaction, once the receipt settled. */
  const settledTxHash = receipt?.settledTxHash ?? null

  /** For `TransactionProgress`: one line while sending, then the receipt. */
  const progress = useMemo<ProgressSource | null>(() => {
    if (state.phase === 'running') return { clientStep: 'sending' }
    if (receiptStatus) return { tabTip: { status: receiptStatus } }
    return null
  }, [state.phase, receiptStatus])

  const refusal = useMemo<TabRefusal | null>(() => {
    if (outcome?.kind === 'refused') return refusalFromTabError(outcome.code)
    return null
  }, [outcome])

  return {
    reader,
    availability,
    state,
    outcome,
    receiptStatus,
    settledTxHash,
    progress,
    refusal,
    send,
    reset,
  }
}
