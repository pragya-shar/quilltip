'use client'

/**
 * The state machine of one wallet-signed tab operation: open a tab, top up,
 * set up quick tips on this device (a new key), revoke a key, close the tab,
 * withdraw, and collect tab earnings. One runs at a time.
 *
 * - Every failure maps through the payment kit (`viewFromTxOutcome`,
 *   `refusalFromTabError`), so the screens show the kit's states.
 * - The indexed tab state confirms the operation (`phaseFromTabOperation`);
 *   polling only drives the UI.
 * - The operation in flight is noted in `sessionStorage`, so a reload in the
 *   middle resumes it ("Checking whether this payment went through")
 *   instead of offering to start again.
 * - A new key is generated before the prepare, and a pending key is reused
 *   after a declined or failed wallet step (README: keep it and retry with
 *   the same public key).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  refusalFromTabError,
  viewFromTxOutcome,
  type ContractNotice,
  type PaymentFailure,
  type TabRefusal,
} from '@/lib/payments/failures'
import {
  tabOperationApplied,
  type ClientStep,
  type ProgressSource,
  type TabOperation,
  type TabSnapshot,
  type WalletGateState,
} from '@/lib/payments/ui-state'
import { FAILURE_COPY } from '@/lib/copy/payment-states'
import { POLL_GRACE_SECONDS } from '@/lib/stellar/v2/tx'
import type { SessionKey } from '@/lib/stellar/v2/tab'
import {
  readPendingOperation,
  writePendingOperation,
  type PendingOperation,
} from '@/lib/tab-ui/device-memory'
import { keyPlan, pendingLocalKey } from '@/lib/tab-ui/key-plan'
import { addUnits } from '@/lib/tab-ui/amounts'
import { runTabOperation } from '@/lib/tab-ui/operation-flow'
import type {
  MyTab,
  MyTabEarnings,
  TabCall,
  TabServices,
} from '@/lib/tab-ui/types'
import type { DeviceKey } from './useDeviceKey'

export type TabFlow = PendingOperation['flow']

export type OperationRequest =
  | { flow: 'tab-open'; amount: string }
  | { flow: 'tab-top-up'; amount: string }
  | { flow: 'tab-new-key' }
  | { flow: 'tab-revoke-key'; keyId: number }
  | { flow: 'tab-close' }
  | { flow: 'tab-withdraw' }
  | { flow: 'collect' }

type Running = {
  request: OperationRequest
  /** Confirmation inputs. */
  before?: string
  publicKey?: string
  wasClosing?: boolean
  step: ClientStep | null
  sent: boolean
  hash: string | null
  maxTime: number | null
  poll: 'SUCCESS' | 'FAILED' | 'TIMEOUT' | null
  declined: boolean
  /** Not sent: show `failed` with this copy (nothing moved). */
  failure: PaymentFailure | null
  /** Restored after a reload. */
  resumed: boolean
}

export type OperationView =
  | { kind: 'idle' }
  /** Render `TransactionProgress` with this source. */
  | {
      kind: 'progress'
      flow: TabFlow
      source: ProgressSource
      failure: PaymentFailure | null
      txHash: string | null
      amount: string | null
      /** A top-up that cancelled a pending withdrawal. */
      cancelledWithdrawal: boolean
    }
  /** Nothing was signed: a wallet gate state to resolve first. */
  | { kind: 'gate'; flow: TabFlow; gate: WalletGateState }
  /** Nothing was signed: a standing condition the chain reported. */
  | { kind: 'notice'; flow: TabFlow; notice: ContractNotice }
  /** Convex refused before anything was built. */
  | { kind: 'refusal'; flow: TabFlow; refusal: TabRefusal }

type Stopped =
  | { kind: 'gate'; flow: TabFlow; gate: WalletGateState }
  | { kind: 'notice'; flow: TabFlow; notice: ContractNotice }
  | { kind: 'refusal'; flow: TabFlow; refusal: TabRefusal }

const MISMATCH_COPY: Record<
  'network' | 'contract' | 'address',
  PaymentFailure
> = {
  network: {
    title: 'This request does not match QuillTip’s settings',
    detail: 'QuillTip prepared it for another network. Nothing was signed.',
  },
  contract: {
    title: 'This request does not match QuillTip’s settings',
    detail: 'QuillTip prepared it for another contract. Nothing was signed.',
  },
  address: {
    title: 'This request does not match your wallet',
    detail: 'QuillTip prepared it for another address. Nothing was signed.',
  },
}

const UNREACHABLE: PaymentFailure = {
  title: 'QuillTip could not prepare this',
  detail: 'Check your connection and try again. Nothing was sent.',
}

function snapshotOf(tab: MyTab | null | undefined): TabSnapshot {
  if (!tab) return null
  return {
    status: tab.status,
    confirmedBalance: tab.confirmedBalance,
    keys: tab.keys.map((k) => ({ keyId: String(k.keyId), revoked: k.revoked })),
  }
}

/** The kit's tab operation, with what confirms it. */
function kitOperation(
  running: Running,
  tab: MyTab | null | undefined,
  earnings: MyTabEarnings | null | undefined
): { operation: TabOperation; snapshot: TabSnapshot } {
  const snapshot = snapshotOf(tab)
  switch (running.request.flow) {
    case 'tab-open':
      return { operation: { flow: 'tab-open' }, snapshot }
    case 'tab-top-up':
      return {
        operation: { flow: 'tab-top-up', before: running.before ?? '0' },
        snapshot,
      }
    case 'tab-new-key': {
      const key = tab?.keys.find(
        (k) => k.publicKey !== null && k.publicKey === running.publicKey
      )
      return {
        operation: {
          flow: 'tab-new-key',
          keyId: key ? String(key.keyId) : 'unregistered',
        },
        snapshot,
      }
    }
    case 'tab-revoke-key':
      return {
        operation: {
          flow: 'tab-revoke-key',
          keyId: String(running.request.keyId),
        },
        snapshot,
      }
    case 'tab-close':
      return { operation: { flow: 'tab-close' }, snapshot }
    case 'tab-withdraw':
      return { operation: { flow: 'tab-withdraw' }, snapshot }
    case 'collect':
      // Collected earnings rise when the indexer applies `Claimed`; read as
      // a balance that must rise above its value when the claim started.
      return {
        operation: { flow: 'tab-top-up', before: running.before ?? '0' },
        snapshot: earnings
          ? { status: 'OPEN', confirmedBalance: earnings.collected, keys: [] }
          : null,
      }
  }
}

export type TabOperationContext = {
  /** The reader's tab screens run tab operations; the writer's panel collects. */
  surface: 'reader' | 'writer'
  services: TabServices
  address: string | null
  gate: WalletGateState
  tab: MyTab | null | undefined
  earnings?: MyTabEarnings | null
  device: DeviceKey
}

export function useTabOperation(ctx: TabOperationContext) {
  const { services, address, tab, earnings } = ctx
  const [running, setRunning] = useState<Running | null>(null)
  const [stopped, setStopped] = useState<Stopped | null>(null)
  const busy = useRef(false)
  const abort = useRef<AbortController | null>(null)
  const ctxRef = useRef(ctx)
  ctxRef.current = ctx

  // Resume an operation noted before a reload.
  useEffect(() => {
    if (!address) return
    const pending = readPendingOperation()
    if (!pending || pending.reader !== address) return
    const request = requestOf(pending)
    if (!request) return
    if ((request.flow === 'collect') !== (ctxRef.current.surface === 'writer'))
      return
    setRunning({
      request,
      before: pending.before,
      publicKey: pending.publicKey,
      step: null,
      sent: Boolean(pending.hash),
      hash: pending.hash ?? null,
      maxTime: pending.maxTime,
      poll: null,
      declined: false,
      failure: null,
      resumed: true,
    })
    const controller = new AbortController()
    abort.current = controller
    const deadline = (pending.maxTime + POLL_GRACE_SECONDS) * 1000
    if (pending.hash) {
      void services
        .poll(pending.hash, pending.maxTime, controller.signal)
        .then((poll) => {
          if (!controller.signal.aborted)
            setRunning((r) => (r ? { ...r, poll } : r))
        })
        .catch(() => {})
    } else {
      const timer = setTimeout(
        () => setRunning((r) => (r && !r.sent ? { ...r, poll: 'TIMEOUT' } : r)),
        Math.max(0, deadline - services.now())
      )
      controller.signal.addEventListener('abort', () => clearTimeout(timer))
    }
    return () => controller.abort()
  }, [address, services])

  const applied = useMemo(() => {
    if (!running) return false
    const { operation, snapshot } = kitOperation(running, tab, earnings)
    return tabOperationApplied(operation, snapshot)
  }, [running, tab, earnings])

  // The indexed state confirmed it: forget the note.
  useEffect(() => {
    if (applied) writePendingOperation(null)
  }, [applied])

  const start = useCallback(async (request: OperationRequest) => {
    const { services, address, gate, tab, earnings, device } = ctxRef.current
    const config = services.config()
    if (busy.current) return
    if (!address || !config || gate.kind !== 'ready') {
      if (gate.kind !== 'ready') {
        setStopped({ kind: 'gate', flow: request.flow, gate })
      }
      return
    }
    busy.current = true
    setStopped(null)
    abort.current?.abort()
    const base: Running = {
      request,
      step: 'simulating',
      sent: false,
      hash: null,
      maxTime: null,
      poll: null,
      declined: false,
      failure: null,
      resumed: false,
      wasClosing: tab?.status === 'CLOSING',
    }
    setRunning(base)
    try {
      let call: TabCall
      let prepare: (() => ReturnType<TabServices['prepareDeposit']>) | null
      const note: Partial<PendingOperation> = {}
      switch (request.flow) {
        case 'tab-open':
        case 'tab-new-key': {
          const scope = device.scope
          if (!scope) throw new Error('No key scope')
          const store = services.keyStore()
          const reuse = pendingLocalKey(device.localKeys ?? [])
          let key: SessionKey | null = reuse
            ? await store.getByPublicKey(scope, reuse.publicKey)
            : null
          key ??= await store.generate(scope)
          await device.refresh()
          const latest = await services.latestLedger()
          const balanceAfter =
            request.flow === 'tab-open'
              ? addUnits(tab?.confirmedBalance ?? '0', request.amount)
              : (tab?.confirmedBalance ?? '0')
          const plan = keyPlan({
            latestLedger: latest.sequence,
            tabBalanceAfter: balanceAfter,
          })
          const params = {
            publicKey: key.info.publicKey,
            validUntil: plan.validUntil,
            spendLimit: plan.spendLimit,
            extractable: key.info.extractable,
          }
          note.publicKey = key.info.publicKey
          base.publicKey = key.info.publicKey
          const { extractable: _extractable, ...onChainKey } = params
          if (request.flow === 'tab-open') {
            note.amount = request.amount
            call = {
              method: 'open_session',
              amount: request.amount,
              key: onChainKey,
            }
            prepare = () =>
              services.prepareOpen({ ...params, amount: request.amount })
          } else {
            call = { method: 'register_key', key: onChainKey }
            prepare = () => services.prepareRegisterKey(params)
          }
          break
        }
        case 'tab-top-up':
          note.before = tab?.confirmedBalance ?? '0'
          note.amount = request.amount
          base.before = note.before
          call = { method: 'deposit', amount: request.amount }
          prepare = () => services.prepareDeposit({ amount: request.amount })
          break
        case 'tab-revoke-key':
          note.keyId = request.keyId
          call = { method: 'revoke_key', keyId: request.keyId }
          prepare = () => services.prepareRevokeKey({ keyId: request.keyId })
          break
        case 'tab-close':
          call = { method: 'withdraw_start' }
          prepare = () => services.prepareWithdrawStart()
          break
        case 'tab-withdraw':
          call = { method: 'withdraw' }
          prepare = () => services.prepareWithdraw()
          break
        case 'collect':
          note.before = earnings?.collected ?? '0'
          base.before = note.before
          call = { method: 'claim' }
          prepare = null
          break
      }
      setRunning({ ...base })
      const startedAt = services.now()
      const result = await runTabOperation({
        prepare,
        call,
        expected: {
          networkPassphrase: config.networkPassphrase,
          tabContractId: config.tabContractId,
          address,
        },
        send: (req, onStep) => services.send(req, onStep),
        poll: (hash, maxTime) => {
          const controller = new AbortController()
          abort.current = controller
          return services.poll(hash, maxTime, controller.signal)
        },
        nowSeconds: () => Math.floor(services.now() / 1000),
        onStep: (step) =>
          setRunning((r) =>
            r ? { ...r, step: step === 'preparing' ? 'simulating' : step } : r
          ),
        onSent: (hash, maxTime) => {
          writePendingOperation({
            flow: request.flow,
            reader: address,
            ...note,
            hash,
            maxTime,
            startedAt,
          })
          setRunning((r) => (r ? { ...r, sent: true, hash, maxTime } : r))
        },
      })
      switch (result.kind) {
        case 'sent':
          setRunning((r) => (r ? { ...r, poll: result.poll } : r))
          return
        case 'refused':
          setRunning(null)
          setStopped({
            kind: 'refusal',
            flow: request.flow,
            refusal: refusalFromTabError(result.code),
          })
          return
        case 'unreachable':
          setRunning({
            ...base,
            step: null,
            poll: 'FAILED',
            failure: UNREACHABLE,
          })
          return
        case 'mismatch':
          setRunning({
            ...base,
            step: null,
            poll: 'FAILED',
            failure: MISMATCH_COPY[result.field],
          })
          return
        case 'not-sent': {
          const view = viewFromTxOutcome(result.outcome)
          switch (view.show.kind) {
            case 'cancelled':
              setRunning(null)
              return
            case 'declined':
              setRunning({ ...base, step: null, declined: true })
              return
            case 'failed':
              setRunning({
                ...base,
                step: null,
                poll: 'FAILED',
                failure: view.show.failure,
              })
              return
            case 'gate':
              setRunning(null)
              setStopped({
                kind: 'gate',
                flow: request.flow,
                gate: view.show.gate,
              })
              return
            case 'notice':
              setRunning(null)
              setStopped({
                kind: 'notice',
                flow: request.flow,
                notice: view.show.notice,
              })
              return
            case 'sent':
              return
          }
        }
      }
    } catch {
      // Key storage or an unexpected error before anything was signed.
      setRunning({
        ...base,
        step: null,
        poll: 'FAILED',
        failure: FAILURE_COPY.notSent,
      })
    } finally {
      busy.current = false
      void ctxRef.current.device.refresh()
    }
  }, [])

  const retry = useCallback(() => {
    if (running) void start(running.request)
  }, [running, start])

  const reset = useCallback(() => {
    abort.current?.abort()
    writePendingOperation(null)
    setRunning(null)
    setStopped(null)
  }, [])

  const view = useMemo<OperationView>(() => {
    if (stopped) return stopped
    if (!running) return { kind: 'idle' }
    const { operation, snapshot } = kitOperation(running, tab, earnings)
    const request = running.request
    return {
      kind: 'progress',
      flow: request.flow,
      source: {
        tabOperation: operation,
        tab: snapshot,
        step: running.step,
        sent: running.sent,
        poll: running.poll,
        declined: running.declined,
      },
      failure: running.failure,
      txHash: running.hash,
      amount:
        request.flow === 'tab-open' || request.flow === 'tab-top-up'
          ? request.amount
          : null,
      cancelledWithdrawal:
        request.flow === 'tab-top-up' && running.wasClosing === true,
    }
  }, [running, stopped, tab, earnings])

  return {
    view,
    /** True while an operation runs and has not reached a result. */
    active:
      running !== null &&
      !applied &&
      running.poll === null &&
      !running.declined,
    applied,
    start,
    retry,
    reset,
  }
}

function requestOf(pending: PendingOperation): OperationRequest | null {
  switch (pending.flow) {
    case 'tab-open':
      return { flow: 'tab-open', amount: pending.amount ?? '0' }
    case 'tab-top-up':
      return { flow: 'tab-top-up', amount: pending.amount ?? '0' }
    case 'tab-new-key':
      return { flow: 'tab-new-key' }
    case 'tab-revoke-key':
      return typeof pending.keyId === 'number'
        ? { flow: 'tab-revoke-key', keyId: pending.keyId }
        : null
    case 'tab-close':
      return { flow: 'tab-close' }
    case 'tab-withdraw':
      return { flow: 'tab-withdraw' }
    case 'collect':
      return { flow: 'collect' }
  }
}
