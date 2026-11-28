'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { Heart } from 'lucide-react'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
import { Button } from '@/components/ui/button'
import {
  AmountSummary,
  PaymentNotice,
  TransactionProgress,
  WalletGate,
} from '@/components/payments'
import type { AmountLine } from '@/components/payments/payment-types'
import { InstallWalletDialog } from '@/components/stellar/InstallWalletDialog'
import { WalletSetupHelp } from '@/components/stellar/WalletSetupHelp'
import { useAuth } from '@/components/providers/AuthContext'
import { useTipV2Flow } from '@/hooks/useTipV2Flow'
import { useTipBasket } from '@/hooks/useTipBasket'
import { useWalletOwnership } from '@/hooks/useWalletOwnership'
import { phaseFromRecord, resolvePaymentView } from '@/lib/payments/ui-state'
import { coreTipSplit } from '@/lib/payments/format'
import { v2Runtime } from '@/lib/stellar/v2/chain-runtime'
import { buildLoginHref } from '@/lib/auth/safeReturnPath'
import { BASKET_COPY } from '@/lib/copy/tip-flow'
import {
  basketTransfers,
  batchRequest,
  MAX_BASKET_ITEMS,
  MAX_BASKET_TRANSFERS,
  type BasketItem,
} from '@/lib/tip/v2/basket'
import { estimateBaseUnits, formatCents } from '@/lib/tip/v2/amount'
import { conditionView, eligibilityCondition } from '@/lib/tip/v2/conditions'
import { kitRecord, moneyMayHaveMoved } from '@/lib/tip/v2/flow'
import { tipGateState } from '@/lib/tip/v2/gate'
import { pendingKey, readPending } from '@/lib/tip/v2/pending'
import { usePathname, useRouter } from 'next/navigation'
import { TipBasketRow } from './TipBasketRow'

interface TipBasketPanelProps {
  onBusyChange: (busy: boolean) => void
  onClose: () => void
}

const BASKET_SCOPE = 'basket'

function rowLabel(item: BasketItem): string {
  const title = item.articleTitle || item.authorName
  return item.highlight ? `Passage in ${title}` : title
}

/**
 * The tip basket: the tips, why one cannot be sent, one payment for all of
 * them, and a result per tip (docs/design-system/tip-flows.md, "Basket").
 */
export function TipBasketPanel({ onBusyChange, onClose }: TipBasketPanelProps) {
  const { store, state } = useTipBasket()
  const flow = useTipV2Flow({
    scope: BASKET_SCOPE,
    batch: true,
    onPrepared: (prepared) => store.startPayment(prepared.submissionId),
  })
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const ownership = useWalletOwnership()
  const router = useRouter()
  const pathname = usePathname()
  const prepareBatch = useMutation(api.tipsV2.prepareBatch)
  const [installOpen, setInstallOpen] = useState(false)
  const [unavailable, setUnavailable] = useState<Record<string, boolean>>({})
  const [announcement, setAnnouncement] = useState('')
  const listRef = useRef<HTMLUListElement>(null)

  const paying = state.submissionId !== null || flow.state.stage !== 'form'
  const items = paying && state.sent ? state.sent : state.items
  const first = items[0]?.articleId
  const eligibility = useQuery(
    api.tipsV2.getTipEligibility,
    first ? { articleId: first as Id<'articles'> } : 'skip'
  )

  const passphrase = useMemo(() => {
    try {
      return v2Runtime().config.passphrase
    } catch {
      return ''
    }
  }, [])

  // The basket stays locked while its payment has a record to follow. If the
  // stored record is gone (cleared storage, or the server has no such
  // record), unlock it: nothing was confirmed for it here.
  const { user } = useAuth()
  useEffect(() => {
    if (!state.submissionId || !user?._id) return
    if (
      !readPending(pendingKey(user._id, BASKET_SCOPE)) ||
      flow.record === null
    ) {
      store.finishPayment(false)
    }
  }, [flow.record, state.submissionId, store, user?._id])

  const running = flow.state.stage === 'preparing' || flow.state.step !== null
  useEffect(() => {
    onBusyChange(running)
  }, [running, onBusyChange])

  const onAvailability = useCallback((id: string, available: boolean) => {
    setUnavailable((prev) =>
      prev[id] === !available ? prev : { ...prev, [id]: !available }
    )
  }, [])

  const walletGate = tipGateState({
    authLoading,
    isAuthenticated,
    wallet: flow.wallet,
    expectedPassphrase: passphrase,
    eligibility: eligibility ?? undefined,
  })
  const flowCondition = flow.state.condition
  const gate =
    flowCondition?.kind === 'gate' && walletGate.kind === 'ready'
      ? flowCondition.gate
      : walletGate
  // Only account-wide conditions block the basket; an article's own problem
  // is shown on its row.
  const accountCondition =
    eligibility && !flowCondition
      ? eligibilityCondition(
          ['PAUSED', 'PRICE_UNAVAILABLE', 'CHAIN_V2_DISABLED'].includes(
            eligibility.reason ?? ''
          ) || eligibility.reason?.startsWith('CHAIN_CONFIG')
            ? eligibility
            : { reason: null }
        )
      : null
  const condition =
    flowCondition && flowCondition.kind !== 'gate'
      ? conditionView(flowCondition)
      : accountCondition
  const view = resolvePaymentView({
    source: flow.source,
    gate,
    notice: condition?.notice ?? null,
    tipsUnavailable: condition?.tipsUnavailable ?? null,
  })

  const refusedIndex =
    flowCondition?.kind === 'basket-item-unavailable'
      ? flowCondition.itemIndex
      : null
  const anyUnavailable = items.some(
    (item, i) => unavailable[item.id] || refusedIndex === i
  )
  const blocked =
    accountCondition !== null || anyUnavailable || items.length === 0

  /** The progress view appears because the reader pressed send or retry. */
  const userStarted = useRef(false)
  /** Set until the run returns, so two activations in one task pay once. */
  const payStarted = useRef(false)
  const pay = () => {
    if (blocked || gate.kind !== 'ready' || payStarted.current) return
    payStarted.current = true
    userStarted.current = true
    if (flowCondition) flow.dismiss()
    const toSend = store.getSnapshot().items
    void flow
      .run({
        request: toSend.map((item) => ({
          articleId: item.articleId,
          articleKey: item.articleKey,
          highlight: item.highlight
            ? {
                articleSlug: item.articleSlug,
                text: item.highlight.text,
                startOffset: item.highlight.startOffset,
                endOffset: item.highlight.endOffset,
              }
            : null,
        })),
        prepare: (requestId) =>
          prepareBatch({ requestId, items: batchRequest(toSend) }),
      })
      .finally(() => {
        payStarted.current = false
      })
  }

  const finish = (paid: boolean) => {
    flow.reset()
    store.finishPayment(paid)
  }

  const remove = (item: BasketItem) => {
    const index = state.items.findIndex((i) => i.id === item.id)
    store.remove(item.id)
    if (flowCondition) flow.dismiss()
    setAnnouncement(`Removed ${rowLabel(item)}.`)
    // Keep focus in the list: the next row's Remove, else the previous one.
    requestAnimationFrame(() => {
      const buttons =
        listRef.current?.querySelectorAll<HTMLButtonElement>(
          '.tip-basket-remove'
        ) ?? []
      const target = buttons[Math.min(index, buttons.length - 1)]
      if (target) target.focus()
      else document.querySelector<HTMLElement>('.tip-basket-sheet h2')?.focus()
    })
  }

  const record = flow.record
  const prepared = flow.prepared
  const price = eligibility?.price?.priceUsd ?? null

  // Amounts per tip: chain values once verified, prepared values once
  // prepared, an estimate before that.
  const amountLines: AmountLine[] = items.map((item, i) => {
    const row = record?.items[i]
    const amount =
      row?.chain?.grossBaseUnits ??
      prepared?.items[i]?.quote.grossBaseUnits ??
      (price ? estimateBaseUnits(item.amountCents, price) : '0')
    return {
      label: rowLabel(item),
      amount,
      ...(row && flow.final
        ? {
            status: phaseFromRecord(kitRecord(row)),
            ...(row.uiState === 'mismatch_author'
              ? { note: 'Paid to the article’s updated payout address.' }
              : row.uiState === 'mismatch_review'
                ? { note: 'Sent, but under review. Do not send it again.' }
                : {}),
          }
        : {}),
    }
  })
  const totalGross =
    record?.chainTotals?.grossBaseUnits ??
    prepared?.totals.grossBaseUnits ??
    amountLines
      .reduce((sum, line) => sum + BigInt(line.amount || '0'), BigInt(0))
      .toString()
  const estimate = !prepared && !record
  const split = coreTipSplit(totalGross)
  const breakdown =
    record?.chainTotals && flow.final
      ? [
          { label: 'To the writers', amount: record.chainTotals.netBaseUnits },
          { label: 'Platform fee', amount: record.chainTotals.feeBaseUnits },
        ]
      : prepared
        ? [
            { label: 'To the writers', amount: prepared.totals.netBaseUnits },
            { label: 'Platform fee', amount: prepared.totals.feeBaseUnits },
          ]
        : split
          ? [
              { label: 'To the writers', amount: split.writer },
              { label: 'Platform fee', amount: split.fee },
            ]
          : []
  const cents = items.reduce((sum, item) => sum + item.amountCents, 0)
  const paid = moneyMayHaveMoved(record?.uiState)

  if (items.length === 0 && !paying) {
    return (
      <div className="tip-v2-body">
        <p className="tip-basket-empty">{BASKET_COPY.empty}</p>
        <Button type="button" className="tip-v2-secondary" onClick={onClose}>
          Close
        </Button>
      </div>
    )
  }

  return (
    <div className="tip-v2-body tip-v2-form">
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      {view.condition && view.condition.kind !== 'gate' ? (
        view.condition.kind === 'tips-unavailable' ? (
          <PaymentNotice
            kind="tips-unavailable"
            reason={view.condition.reason}
            announce
          />
        ) : condition?.props ? (
          <PaymentNotice
            {...condition.props}
            announce={flowCondition !== null}
            {...(condition.props.kind === 'basket-item-unavailable' &&
            refusedIndex !== null &&
            items[refusedIndex]
              ? {
                  action: {
                    onClick: () => remove(items[refusedIndex]!),
                  },
                }
              : {})}
          />
        ) : null
      ) : null}

      {view.progress ? (
        <>
          <AmountSummary
            label="Basket total"
            total={totalGross}
            items={amountLines}
            breakdown={breakdown}
            quoteCents={cents}
          />
          <TransactionProgress
            flow="tip-basket"
            source={flow.source!}
            txHash={record?.txHash ?? flow.state.txHash}
            failure={flow.state.failure}
            slow={flow.slow}
            onRetry={() => {
              finish(false)
              pay()
            }}
            retryAllowed={view.canRetry}
            startedByUser={userStarted.current}
            reference={
              record?.uiState === 'mismatch_review'
                ? record.submissionId
                : undefined
            }
            helpHref="/support"
            resultPlace="your tip history"
            doneAction={{
              onClick: () => {
                finish(paid)
                if (paid) onClose()
              },
            }}
          />
        </>
      ) : (
        <>
          <ul className="tip-basket-list" ref={listRef} aria-label="Tips">
            {items.map((item, i) => (
              <TipBasketRow
                key={item.id}
                item={item}
                refused={refusedIndex === i}
                disabled={paying}
                onRemove={remove}
                onAvailability={onAvailability}
              />
            ))}
          </ul>
          <p className="tip-basket-limits">
            {BASKET_COPY.limits(items.length, basketTransfers(items))}
            <span className="sr-only">
              {' '}
              (at most {MAX_BASKET_ITEMS} tips and {MAX_BASKET_TRANSFERS}{' '}
              transfers in one payment)
            </span>
          </p>
          <AmountSummary
            label="Basket total"
            total={totalGross}
            breakdown={breakdown}
            quoteCents={cents}
            estimate={estimate}
          />
          <div className="tip-actions">
            <WalletGate
              state={gate}
              onSignIn={() =>
                router.push(
                  buildLoginHref(`${pathname}${window.location.search}`)
                )
              }
              onInstall={() => setInstallOpen(true)}
              onConnect={() => {
                if (flowCondition) flow.dismiss()
                void flow.wallet.connect().catch(() => undefined)
              }}
              onRecheck={() => {
                if (flowCondition) flow.dismiss()
                void flow.wallet.refreshConnection()
              }}
              onVerify={() => {
                if (flowCondition) flow.dismiss()
                void ownership.verify()
              }}
              busy={
                ownership.status === 'challenge' ||
                ownership.status === 'sign' ||
                ownership.status === 'verify'
              }
              help={gate.kind === 'no-wallet' ? <WalletSetupHelp /> : undefined}
            >
              <Button
                type="button"
                className="tip-primary"
                onClick={pay}
                aria-disabled={blocked || undefined}
              >
                <Heart className="w-4 h-4" aria-hidden="true" />
                {BASKET_COPY.pay(items.length, formatCents(cents))}
              </Button>
            </WalletGate>
          </div>
          {anyUnavailable && !flowCondition ? (
            <p className="tip-v2-field-error">
              Remove the tips that can’t be sent, then send the rest.
            </p>
          ) : null}
          {ownership.error ? (
            <p className="tip-v2-field-error" role="alert">
              {ownership.error.title}. {ownership.error.detail}
            </p>
          ) : null}
        </>
      )}
      <InstallWalletDialog open={installOpen} onOpenChange={setInstallOpen} />
    </div>
  )
}
