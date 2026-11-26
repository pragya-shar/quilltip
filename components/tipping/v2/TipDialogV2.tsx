'use client'

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react'
import { useMutation } from 'convex/react'
import { CircleAlert, Heart, ShoppingBasket } from 'lucide-react'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'
import type { TipEligibility } from '@/convex/tipsV2'
import { Button } from '@/components/ui/button'
import {
  AmountSummary,
  PaymentNotice,
  TestnetLabel,
  TransactionProgress,
  WalletGate,
} from '@/components/payments'
import { InstallWalletDialog } from '@/components/stellar/InstallWalletDialog'
import { WalletSetupHelp } from '@/components/stellar/WalletSetupHelp'
import { TipPassageContext } from '@/components/tipping/TipPassageContext'
import { useAuth } from '@/components/providers/AuthContext'
import { useTipV2Flow } from '@/hooks/useTipV2Flow'
import { useTipBasket } from '@/hooks/useTipBasket'
import { useWalletOwnership } from '@/hooks/useWalletOwnership'
import { resolvePaymentView } from '@/lib/payments/ui-state'
import { coreTipSplit } from '@/lib/payments/format'
import { buildLoginHref } from '@/lib/auth/safeReturnPath'
import { v2Runtime } from '@/lib/stellar/v2/chain-runtime'
import { AMOUNT_ERRORS, BASKET_COPY, TIP_DIALOG } from '@/lib/copy/tip-flow'
import {
  TIP_MAX_CENTS,
  TIP_PRESET_CENTS,
  checkAmount,
  estimateBaseUnits,
  formatCents,
  parseDollars,
} from '@/lib/tip/v2/amount'
import { tipGateState } from '@/lib/tip/v2/gate'
import { articleScope, highlightScope } from '@/lib/tip/v2/pending'
import { conditionView, eligibilityCondition } from '@/lib/tip/v2/conditions'
import type { BasketHighlight } from '@/lib/tip/v2/basket'
import { usePathname, useRouter } from 'next/navigation'

interface TipDialogV2Props {
  variant: 'article' | 'highlight'
  articleId: Id<'articles'>
  articleSlug: string
  articleTitle: string
  authorName: string
  eligibility: TipEligibility
  highlight?: BasketHighlight
  /** A wallet step is running; the dialog should not close. */
  onBusyChange: (busy: boolean) => void
  onOpenBasket: () => void
  onDone: () => void
  onConfirmed?: () => void
}

type AddResult =
  | { ok: true }
  | { ok: false; title: string; detail: string }
  | null

/**
 * The v2 tip dialog body: amount, wallet gate, progress and result, on the
 * payment kit (docs/design-system/tip-flows.md). The server record decides
 * every result.
 */
export function TipDialogV2({
  variant,
  articleId,
  articleSlug,
  articleTitle,
  authorName,
  eligibility,
  highlight,
  onBusyChange,
  onOpenBasket,
  onDone,
  onConfirmed,
}: TipDialogV2Props) {
  const scope =
    variant === 'highlight' && highlight
      ? highlightScope(articleId, highlight.startOffset, highlight.endOffset)
      : articleScope(articleId)
  const flow = useTipV2Flow({ scope, minTipCents: eligibility.minTipCents })
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const basket = useTipBasket()
  const ownership = useWalletOwnership()
  const router = useRouter()
  const pathname = usePathname()
  const prepareDirect = useMutation(api.tipsV2.prepareDirectTip)
  const prepareHighlight = useMutation(api.tipsV2.prepareHighlightTip)
  const [installOpen, setInstallOpen] = useState(false)

  const [preset, setPreset] = useState<number | null>(TIP_PRESET_CENTS[0])
  const [custom, setCustom] = useState('')
  const [message, setMessage] = useState('')
  const [amountError, setAmountError] = useState<string | null>(null)
  const [added, setAdded] = useState<AddResult>(null)
  const ids = { custom: useId(), error: useId(), note: useId(), hint: useId() }
  const customRef = useRef<HTMLInputElement>(null)
  const sendRef = useRef<HTMLButtonElement>(null)
  /** The reader acted in the gate; focus "Send tip" once it opens. */
  const gateActed = useRef(false)

  const passphrase = useMemo(() => {
    try {
      return v2Runtime().config.passphrase
    } catch {
      return ''
    }
  }, [])

  const cents = custom.trim() ? parseDollars(custom) : preset
  const check = checkAmount(cents, eligibility.minTipCents, custom)
  const running = flow.state.stage === 'preparing' || flow.state.step !== null

  useEffect(() => {
    onBusyChange(running)
  }, [running, onBusyChange])

  const confirmed = flow.record?.uiState === 'confirmed'
  useEffect(() => {
    if (confirmed) onConfirmed?.()
  }, [confirmed, onConfirmed])

  // The gate: a wallet failure the flow saw wins until the reader acts on it.
  const walletGate = tipGateState({
    authLoading,
    isAuthenticated,
    wallet: flow.wallet,
    expectedPassphrase: passphrase,
    eligibility,
  })
  const flowCondition = flow.state.condition
  const gateKind =
    flowCondition?.kind === 'gate' && walletGate.kind === 'ready'
      ? flowCondition.gate.kind
      : walletGate.kind
  useEffect(() => {
    // The wallet picker returns focus inside the dialog, not to the gate, so
    // the gate's own hand-off cannot run; finish it here.
    if (gateKind === 'ready' && gateActed.current) {
      gateActed.current = false
      sendRef.current?.focus()
    }
  }, [gateKind])
  const gate =
    flowCondition?.kind === 'gate' && walletGate.kind === 'ready'
      ? flowCondition.gate
      : walletGate
  const condition =
    flowCondition && flowCondition.kind !== 'gate'
      ? conditionView(flowCondition)
      : eligibilityCondition(eligibility)
  const view = resolvePaymentView({
    source: flow.source,
    gate,
    notice: condition?.notice ?? null,
    tipsUnavailable: condition?.tipsUnavailable ?? null,
  })
  // The amount form stays with a gate (the gate wraps "Send tip") and with a
  // refusal the reader can fix by choosing again.
  const showForm =
    view.progress === null &&
    (view.condition === null ||
      view.condition.kind === 'gate' ||
      (view.condition.kind === 'notice' &&
        !['paused'].includes(view.condition.notice.kind)))

  const request = () => [
    {
      articleId,
      articleKey: eligibility.articleKey,
      highlight:
        variant === 'highlight' && highlight
          ? {
              articleSlug,
              text: highlight.text,
              startOffset: highlight.startOffset,
              endOffset: highlight.endOffset,
            }
          : null,
    },
  ]
  const start = (amountCents: number) =>
    flow.run({
      request: request(),
      prepare: (requestId) =>
        variant === 'highlight' && highlight
          ? prepareHighlight({
              requestId,
              articleId,
              amountCents,
              highlight,
            })
          : prepareDirect({
              requestId,
              articleId,
              amountCents,
              ...(message.trim() ? { message: message.trim() } : {}),
            }),
    })
  const lastAmount = useRef<number | null>(null)

  const amountMessage = (c: typeof check): string | null => {
    if (c.ok) return null
    switch (c.reason) {
      case 'empty':
        return AMOUNT_ERRORS.empty
      case 'invalid':
        return AMOUNT_ERRORS.invalid
      case 'below':
        return AMOUNT_ERRORS.belowMinimum(formatCents(c.min))
      case 'above':
        return AMOUNT_ERRORS.aboveMaximum(formatCents(TIP_MAX_CENTS))
    }
  }

  // A standing condition from the server (price, pause, switch) blocks
  // sending; a refusal of the last attempt clears when the reader sends again.
  const blocked = !flowCondition && condition !== null

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!check.ok) {
      setAmountError(amountMessage(check))
      customRef.current?.focus()
      return
    }
    if (blocked || gate.kind !== 'ready') return
    if (flowCondition) flow.dismiss()
    setAmountError(null)
    setAdded(null)
    lastAmount.current = check.cents
    void start(check.cents)
  }

  const onAddToBasket = () => {
    if (!check.ok) {
      setAmountError(amountMessage(check))
      customRef.current?.focus()
      return
    }
    setAmountError(null)
    const result = basket.store.add({
      articleId,
      articleSlug,
      articleTitle,
      authorName,
      amountCents: check.cents,
      highlight: variant === 'highlight' && highlight ? highlight : null,
      transferCount: eligibility.transferCount ?? 0,
      articleKey: eligibility.articleKey,
    })
    if (result.ok) {
      setAdded({ ok: true })
      return
    }
    const copy =
      result.reason === 'full_items'
        ? BASKET_COPY.fullItems
        : result.reason === 'full_transfers'
          ? BASKET_COPY.fullTransfers(result.needed ?? 0, result.left ?? 0)
          : result.reason === 'duplicate'
            ? BASKET_COPY.duplicate
            : result.reason === 'busy'
              ? BASKET_COPY.busy
              : BASKET_COPY.unavailable
    setAdded({ ok: false, ...copy })
  }

  const clearRefusal = () => {
    if (flowCondition) flow.dismiss()
    setAmountError(null)
    setAdded(null)
  }

  const estimate =
    check.ok && eligibility.price
      ? estimateBaseUnits(check.cents, eligibility.price.priceUsd)
      : null
  const prepared = flow.prepared
  const record = flow.record
  const chainNet = record?.chainTotals?.netBaseUnits ?? null
  const redirected = record?.uiState === 'mismatch_author'

  const conditionNode = view.condition ? (
    view.condition.kind === 'tips-unavailable' ? (
      <PaymentNotice
        kind="tips-unavailable"
        reason={view.condition.reason}
        announce={flowCondition !== null}
      />
    ) : view.condition.kind === 'notice' && condition?.props ? (
      <PaymentNotice
        {...condition.props}
        announce={flowCondition !== null}
        {...(condition.props.kind === 'insufficient-balance'
          ? {
              action: {
                onClick: () => {
                  clearRefusal()
                  customRef.current?.focus()
                },
              },
            }
          : {})}
      />
    ) : null
  ) : null

  return (
    <div className="tip-v2-body">
      {variant === 'highlight' && highlight ? (
        <TipPassageContext text={highlight.text} />
      ) : articleTitle ? (
        <p className="tip-passage">{articleTitle}</p>
      ) : null}

      {conditionNode}

      {view.progress ? (
        <>
          {prepared && !flow.final ? (
            <AmountSummary
              total={prepared.totals.grossBaseUnits}
              breakdown={[
                {
                  label: 'To the author',
                  amount: prepared.totals.netBaseUnits,
                },
                { label: 'Platform fee', amount: prepared.totals.feeBaseUnits },
              ]}
              quoteCents={prepared.totals.amountCents}
            />
          ) : null}
          <TransactionProgress
            flow={variant === 'highlight' ? 'highlight-tip' : 'direct-tip'}
            source={flow.source!}
            txHash={record?.txHash ?? flow.state.txHash}
            failure={flow.state.failure}
            slow={flow.slow}
            onRetry={() => {
              if (lastAmount.current !== null) void start(lastAmount.current)
              else flow.reset()
            }}
            retryAllowed={view.canRetry && lastAmount.current !== null}
            summary={
              chainNet
                ? redirected
                  ? { amount: chainNet }
                  : { amount: chainNet, to: authorName }
                : undefined
            }
            reference={
              record?.uiState === 'mismatch_review'
                ? record.submissionId
                : undefined
            }
            helpHref="/support"
            resultPlace="your tip history"
            doneAction={{
              onClick: () => {
                flow.reset()
                onDone()
              },
            }}
            headingLevel={3}
          />
          {flow.final && view.canRetry && lastAmount.current === null ? (
            <Button
              type="button"
              className="tip-primary"
              onClick={() => flow.reset()}
            >
              Start a new tip
            </Button>
          ) : null}
        </>
      ) : null}

      {showForm ? (
        <form className="tip-v2-form" onSubmit={onSubmit} noValidate>
          <fieldset className="tip-v2-fieldset">
            <legend>{TIP_DIALOG.amountLegend}</legend>
            <div
              className="tip-presets"
              role="group"
              aria-label="Preset amounts"
            >
              {TIP_PRESET_CENTS.map((value) => (
                <button
                  key={value}
                  type="button"
                  className="tip-preset"
                  aria-pressed={!custom.trim() && preset === value}
                  onClick={() => {
                    setPreset(value)
                    setCustom('')
                    clearRefusal()
                  }}
                >
                  {formatCents(value)}
                </button>
              ))}
            </div>
            <div>
              <label htmlFor={ids.custom} className="tip-field-label">
                {TIP_DIALOG.customLabel}
              </label>
              <div className="tip-v2-dollar">
                <span aria-hidden="true">$</span>
                <input
                  ref={customRef}
                  id={ids.custom}
                  className="tip-input"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  spellCheck={false}
                  enterKeyHint="send"
                  placeholder="0.00"
                  value={custom}
                  aria-invalid={amountError ? true : undefined}
                  aria-describedby={
                    amountError ? `${ids.error} ${ids.hint}` : ids.hint
                  }
                  onChange={(event) => {
                    setCustom(event.target.value)
                    if (amountError) {
                      const next = event.target.value.trim()
                        ? parseDollars(event.target.value)
                        : preset
                      setAmountError(
                        amountMessage(
                          checkAmount(
                            next,
                            eligibility.minTipCents,
                            event.target.value
                          )
                        )
                      )
                    }
                    if (flowCondition) flow.dismiss()
                    setAdded(null)
                  }}
                  onBlur={() => {
                    if (custom.trim()) setAmountError(amountMessage(check))
                  }}
                  data-1p-ignore
                  data-lpignore="true"
                />
              </div>
              {amountError ? (
                <p id={ids.error} className="tip-v2-field-error">
                  <CircleAlert aria-hidden="true" />
                  {amountError}
                </p>
              ) : null}
              <p id={ids.hint} className="tip-hint">
                {TIP_DIALOG.customHint(
                  formatCents(Math.max(eligibility.minTipCents ?? 1, 1)),
                  formatCents(TIP_MAX_CENTS)
                )}
              </p>
            </div>
          </fieldset>

          {estimate && estimate !== '0' ? (
            <AmountSummary
              total={estimate}
              breakdown={(() => {
                const split = coreTipSplit(estimate)
                return split
                  ? [
                      { label: 'To the author', amount: split.writer },
                      { label: 'Platform fee', amount: split.fee },
                    ]
                  : []
              })()}
              quoteCents={check.ok ? check.cents : null}
              estimate
            />
          ) : (
            <TestnetLabel detail />
          )}

          {variant === 'article' ? (
            <details>
              <summary className="tip-help-trigger">
                {TIP_DIALOG.messageLabel}
              </summary>
              <div className="tip-help-content">
                <label htmlFor={ids.note} className="tip-field-label">
                  Note
                </label>
                <textarea
                  id={ids.note}
                  className="tip-input resize-none"
                  rows={3}
                  maxLength={500}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      (event.metaKey || event.ctrlKey) &&
                      event.key === 'Enter'
                    ) {
                      event.currentTarget.form?.requestSubmit()
                    }
                  }}
                />
                <p className="tip-hint">{message.length}/500 characters</p>
              </div>
            </details>
          ) : null}

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
                gateActed.current = true
                if (flowCondition) flow.dismiss()
                void flow.wallet.connect().catch(() => undefined)
              }}
              onRecheck={() => {
                gateActed.current = true
                if (flowCondition) flow.dismiss()
                void flow.wallet.refreshConnection()
              }}
              onVerify={() => {
                gateActed.current = true
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
                ref={sendRef}
                type="submit"
                className="tip-primary"
                aria-disabled={blocked || undefined}
              >
                <Heart className="w-4 h-4" aria-hidden="true" />
                {TIP_DIALOG.send}
              </Button>
            </WalletGate>
            {gate.kind !== 'signed-out' && gate.kind !== 'checking' ? (
              <Button
                type="button"
                variant="outline"
                className="tip-v2-secondary"
                onClick={onAddToBasket}
              >
                <ShoppingBasket className="w-4 h-4" aria-hidden="true" />
                {TIP_DIALOG.addToBasket}
              </Button>
            ) : null}
          </div>
          <div className="tip-v2-added" role="status" aria-live="polite">
            {added?.ok ? (
              <>
                <span>{TIP_DIALOG.added}</span>
                <button
                  type="button"
                  className="tip-v2-link"
                  onClick={onOpenBasket}
                >
                  {TIP_DIALOG.openBasket}
                </button>
              </>
            ) : added ? (
              <span>
                <strong>{added.title}.</strong> {added.detail}
              </span>
            ) : null}
          </div>
          {ownership.error ? (
            <p className="tip-v2-field-error" role="alert">
              {ownership.error.title}. {ownership.error.detail}
            </p>
          ) : null}
        </form>
      ) : null}

      <InstallWalletDialog open={installOpen} onOpenChange={setInstallOpen} />
    </div>
  )
}
