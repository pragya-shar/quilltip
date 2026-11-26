/**
 * The client side of a tab tip, between `tabs.prepareTip` and
 * `tabs.submitTip` (docs/architecture/v2/05-flows-and-admin.md, section 5.6,
 * steps 2 and 4). No wallet is involved: the session key signs.
 *
 * Flow for the caller:
 *
 * 1. `prepared = await prepareTip({ requestId, articleId, amountCents, keyId })`
 * 2. `result = await signTabTip(prepared, deps)`
 *    - `signed`: `accepted = await submitTip(result.submit)`, then
 *      `await commitAcceptedTip(accepted, deps)`.
 *    - `retry_prepare`: prepare again with a new `requestId` and call
 *      `signTabTip` once more.
 *    - `stop`: do not sign; show `result.reason` (see README).
 * 3. If the submit response is lost, resubmit the same `result.submit`;
 *    Convex returns the same acceptance.
 */
import type { V2ClientConfig } from '../config'
import { tabConfig } from './config'
import { TabClientError } from './errors'
import {
  createLocalLedger,
  decideStepTwo,
  type LedgerRecord,
  type LocalLedger,
  type MismatchReason,
  type ServerPairState,
} from './local-ledger'
import { receiptLeafHex } from './merkle'
import {
  createSessionKeyStore,
  type SessionKeyScope,
  type SessionKeyStore,
} from './session-key'
import {
  PrepareCheckError,
  buildReceipt,
  buildVoucher,
  submitTipArgs,
  type PrepareProblem,
  type PreparedTabTip,
  type SubmitTipArgs,
  type SubmittedTabTip,
} from './voucher'
import { bytesToHex, hexToBytes } from './bytes'

export type SignTabTipDeps = {
  keys: SessionKeyStore
  ledger: LocalLedger
  /** From the app's network config; never from the prepare response. */
  networkPassphrase: string
  tabContractId: string
  readerAddress: string
  /** Optional cap on a single tip, in base units. */
  maxAmount?: bigint
  /** Timestamps for local records only; never compared with `expiresAt`. */
  now?: () => number
}

/** Why `signTabTip` refused to sign. Only `ledger_mismatch` marks the key. */
export type StopReason =
  | PrepareProblem
  /** This browser does not hold the key Convex named. */
  | 'key_missing'
  /** This browser stopped the key earlier. */
  | 'key_unusable'
  /** The local ledger and Convex disagree twice: the key is now unusable. */
  | 'ledger_mismatch'

export type SignTabTipResult<Id extends string = string> =
  | {
      kind: 'signed'
      submit: SubmitTipArgs<Id>
      /** The voucher this signature covers. */
      voucher: {
        keyId: number
        writer: string
        cumulative: string
        receiptsRoot: string
        leafHashes: string[]
        publicKey: string
      }
      /** True when this repeats a voucher already signed here. */
      replay: boolean
    }
  | {
      kind: 'retry_prepare'
      reason: MismatchReason | 'concurrent_update'
    }
  | { kind: 'stop'; reason: StopReason; message: string }

/**
 * Default dependencies over the real IndexedDB and WebCrypto. The network
 * passphrase and Tab contract id come from `v2Config()`; pass `config` only
 * in tests and fixtures.
 */
export function defaultTabSigningDeps(options: {
  readerAddress: string
  maxAmount?: bigint
  config?: Pick<V2ClientConfig, 'passphrase' | 'tabContractId'>
}): SignTabTipDeps {
  return {
    ...tabConfig(options.config),
    readerAddress: options.readerAddress,
    maxAmount: options.maxAmount,
    keys: createSessionKeyStore(),
    ledger: createLocalLedger(),
  }
}

const STOP_MESSAGES: Record<StopReason, string> = {
  wrong_tab: 'The prepared tip names another Tab contract.',
  wrong_reader: 'The prepared tip names another reader.',
  malformed: 'The prepared tip is malformed.',
  inconsistent: 'The prepared tip is inconsistent.',
  pair_full: 'This key reached its receipt limit for this writer.',
  above_limit: 'The tip is above the allowed amount.',
  key_missing: "This device's quick-tip key is gone.",
  key_unusable: 'Quick tips with this key are stopped on this device.',
  ledger_mismatch:
    'The tab history differs from this device. Quick tips with this key are stopped.',
}

function stop(reason: StopReason): {
  kind: 'stop'
  reason: StopReason
  message: string
} {
  return { kind: 'stop', reason, message: STOP_MESSAGES[reason] }
}

/**
 * Checks a prepared tip against the local ledger, builds the receipt, root
 * and payload, signs with the session key, and returns the `submitTip`
 * argument or a typed reason not to sign.
 */
export async function signTabTip<Id extends string>(
  prepared: PreparedTabTip<Id>,
  deps: SignTabTipDeps
): Promise<SignTabTipResult<Id>> {
  const now = deps.now ?? (() => Date.now())
  const scope: SessionKeyScope = {
    tabContractId: deps.tabContractId,
    readerAddress: deps.readerAddress,
  }

  // 1. The prepare response itself.
  let receipt
  try {
    receipt = buildReceipt(prepared, {
      tabContractId: deps.tabContractId,
      readerAddress: deps.readerAddress,
      maxAmount: deps.maxAmount,
    })
  } catch (error) {
    if (error instanceof PrepareCheckError) return stop(error.problem)
    throw error
  }
  const { keyId, writer } = prepared

  // 2. The key.
  const key = await deps.keys.get(scope, keyId)
  if (!key) return stop('key_missing')
  if (key.info.unusable) return stop('key_unusable')

  const server: ServerPairState = {
    cumulativeBefore: prepared.cumulativeBefore,
    leafHashes: prepared.leafHashes,
  }
  const leafHash = receiptLeafHex(receipt)

  // An identical resubmit of a voucher signed here: reuse its signature.
  const first = await deps.ledger.read(scope, keyId, writer)
  const earlier = replayOf(first, prepared.prepareId, prepared.seq, leafHash)
  if (earlier) {
    const unsigned = buildVoucher(prepared, receipt, {
      networkPassphrase: deps.networkPassphrase,
      publicKey: key.publicKey(),
      priorLeafHashes: server.leafHashes,
    })
    return signed(
      prepared,
      unsigned,
      hexToBytes(earlier.signature, 64),
      key.info.publicKey,
      true
    )
  }

  // 3. The step-2 ledger rule.
  let decision = decideStepTwo({ server, first })
  if (decision.action === 'reread') {
    const reread = await deps.ledger.read(scope, keyId, writer)
    decision = decideStepTwo({ server, first, reread })
  }
  if (decision.action === 'retry_prepare') {
    await deps.ledger.markMismatch(scope, keyId, writer)
    return { kind: 'retry_prepare', reason: decision.reason }
  }
  if (decision.action === 'stop') {
    await deps.keys.markUnusable(scope, key.info.publicKey, 'ledger_mismatch')
    return stop('ledger_mismatch')
  }
  if (decision.action !== 'proceed')
    throw new TabClientError('INVALID_INPUT', 'unreachable ledger decision')

  // 4. Receipt, root, payload, signature.
  const unsigned = buildVoucher(prepared, receipt, {
    networkPassphrase: deps.networkPassphrase,
    publicKey: key.publicKey(),
    priorLeafHashes: decision.state.leafHashes,
  })
  const signature = await key.sign(unsigned.payload)

  // 5. Write-ahead, as a compare-and-set against the checked state.
  const stored = await deps.ledger.recordPending(scope, keyId, writer, server, {
    seq: prepared.seq,
    cumulativeAfter: unsigned.cumulative,
    leafHash: unsigned.leafHash,
    prepareId: prepared.prepareId,
    signature: bytesToHex(signature),
    createdAt: now(),
  })
  if (!stored) return { kind: 'retry_prepare', reason: 'concurrent_update' }
  return signed(prepared, unsigned, signature, key.info.publicKey, false)
}

function replayOf(
  record: LedgerRecord | null,
  prepareId: string,
  seq: number,
  leafHash: string
) {
  return (
    record?.signed.find(
      (e) =>
        e.prepareId === prepareId && e.seq === seq && e.leafHash === leafHash
    ) ?? null
  )
}

function signed<Id extends string>(
  prepared: PreparedTabTip<Id>,
  unsigned: ReturnType<typeof buildVoucher>,
  signature: Uint8Array,
  publicKey: string,
  replay: boolean
): SignTabTipResult<Id> {
  return {
    kind: 'signed',
    submit: submitTipArgs(prepared.prepareId, unsigned.receipt, signature),
    voucher: {
      keyId: prepared.keyId,
      writer: prepared.writer,
      cumulative: unsigned.cumulative,
      receiptsRoot: unsigned.receiptsRoot,
      leafHashes: unsigned.leafHashes,
      publicKey,
    },
    replay,
  }
}

/**
 * Step 4 of spec 5.6: after `tabs.submitTip` accepts, append the receipt
 * leaf and the new cumulative to the local ledger.
 */
export async function commitAcceptedTip(
  accepted: SubmittedTabTip,
  deps: Pick<SignTabTipDeps, 'ledger' | 'tabContractId' | 'readerAddress'>
) {
  if (
    accepted.voucher.tabContractId !== deps.tabContractId ||
    accepted.voucher.reader !== deps.readerAddress
  )
    throw new TabClientError(
      'INVALID_INPUT',
      'The accepted voucher belongs to another tab or reader.'
    )
  return deps.ledger.commitAccepted(
    { tabContractId: deps.tabContractId, readerAddress: deps.readerAddress },
    {
      keyId: accepted.voucher.keyId,
      writer: accepted.voucher.writer,
      cumulative: accepted.voucher.cumulative,
      leafHashes: accepted.leafHashes,
    }
  )
}
