/**
 * Article NFT calls from a Convex prepare result
 * (docs/architecture/v2/05-flows-and-admin.md, section 5.10). Arguments are
 * encoded with the generated NFT bindings' contract spec, from the prepared
 * response exactly as the server returns it.
 *
 * Before anything is signed, the client checks the prepared values against
 * its own configuration and what the user saw: the network, the NFT
 * contract, the signer, the article or token, and for a transfer the
 * recipient the user confirmed. A mismatch is refused locally.
 *
 * The recipient checks here also run while the user types, so the transfer
 * form and the server refuse the same addresses.
 */
import { MuxedAccount, StrKey, type xdr } from '@stellar/stellar-sdk'
import { Client as NftClient } from './bindings/nft'
import type { ContractCall } from './tx'

type PreparedBase = {
  submissionId: string
  /** True when an earlier call with the same `requestId` created it. */
  existing: boolean
  network: string
  networkPassphrase: string
  /** The NFT contract. */
  contractId: string
  /** Unix seconds: the transaction's upper time bound. */
  maxTime: number
  /** The only signer; also the transaction source. */
  signer: string
}

/** `nftsV2.prepareMint`, structurally (convex/nftsV2.ts `PreparedNftMint`). */
export type PreparedNftMint = PreparedBase & {
  action: 'mint'
  method: 'mint'
  args: { article_id: string }
  articleId: string
  articleKey: string
}

/** `nftsV2.prepareTransfer`, structurally (`PreparedNftTransfer`). */
export type PreparedNftTransfer = PreparedBase & {
  action: 'transfer'
  method: 'transfer'
  args: { from: string; to: string; token_id: number }
  nftId: string
  tokenId: number
  recipient: {
    address: string
    userId: string | null
    username: string | null
  }
}

export type PreparedNftCall = PreparedNftMint | PreparedNftTransfer

export type NftCallCheck =
  | 'network'
  | 'contract'
  | 'signer'
  | 'action'
  | 'article'
  | 'token'
  | 'owner'
  | 'recipient'
  | 'expired'

export class NftCallError extends Error {
  constructor(
    readonly check: NftCallCheck,
    message: string
  ) {
    super(message)
    this.name = 'NftCallError'
  }
}

/** What the client knows independently of the prepare response. */
export type NftCallExpectation = {
  networkPassphrase: string
  nftContractId: string | null
  /** The platform contracts that can never hold an NFT. */
  platformContracts?: readonly (string | null | undefined)[]
  /** Unix milliseconds; defaults to `Date.now()`. */
  now?: number
} & (
  | { action: 'mint'; articleId: string }
  | {
      action: 'transfer'
      nftId: string
      /** The token ID the page shows. */
      tokenId: number
      /** The caller's verified address, which must own the token. */
      owner: string
      /**
       * The address the user confirmed. Null when the user named a QuillTip
       * user: the review step then shows the server's resolved address, and
       * the user confirms that address.
       */
      recipient: string | null
    }
)

const HEX_32 = /^[0-9a-f]{64}$/

function isAccount(address: unknown): address is string {
  return typeof address === 'string' && StrKey.isValidEd25519PublicKey(address)
}

function isRecipientAddress(address: unknown): address is string {
  return (
    typeof address === 'string' &&
    (StrKey.isValidEd25519PublicKey(address) || StrKey.isValidContract(address))
  )
}

function isU32(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 0xffffffff
  )
}

/**
 * Checks a prepared mint or transfer before the wallet is asked to sign.
 * Throws `NftCallError`; nothing is signed when it throws.
 */
export function checkPreparedNftCall(
  prepared: PreparedNftCall,
  expected: NftCallExpectation
): void {
  const now = expected.now ?? Date.now()
  if (prepared.networkPassphrase !== expected.networkPassphrase) {
    throw new NftCallError(
      'network',
      'The server prepared this for another network. Nothing was signed.'
    )
  }
  if (
    !expected.nftContractId ||
    prepared.contractId !== expected.nftContractId
  ) {
    throw new NftCallError(
      'contract',
      'The server prepared this for another contract. Nothing was signed.'
    )
  }
  if (!isAccount(prepared.signer)) {
    throw new NftCallError('signer', 'The signing address is not valid.')
  }
  if (
    prepared.action !== expected.action ||
    prepared.method !== expected.action
  ) {
    throw new NftCallError('action', 'The prepared action does not match.')
  }
  if (!Number.isFinite(prepared.maxTime) || prepared.maxTime * 1000 <= now) {
    throw new NftCallError(
      'expired',
      'This request timed out before it was signed. Nothing was sent.'
    )
  }

  if (prepared.action === 'mint' && expected.action === 'mint') {
    if (
      prepared.articleId !== expected.articleId ||
      !HEX_32.test(prepared.args.article_id) ||
      prepared.args.article_id !== prepared.articleKey
    ) {
      throw new NftCallError('article', 'The article does not match.')
    }
    return
  }

  if (prepared.action === 'transfer' && expected.action === 'transfer') {
    const { from, to, token_id } = prepared.args
    if (
      prepared.nftId !== expected.nftId ||
      !isU32(token_id) ||
      token_id !== prepared.tokenId ||
      token_id !== expected.tokenId
    ) {
      throw new NftCallError('token', 'The NFT does not match.')
    }
    if (from !== prepared.signer || from !== expected.owner) {
      throw new NftCallError(
        'owner',
        'Only the wallet that owns this NFT can transfer it.'
      )
    }
    const platform = new Set(
      (expected.platformContracts ?? []).filter((id): id is string => !!id)
    )
    platform.add(expected.nftContractId)
    if (
      !isRecipientAddress(to) ||
      to === from ||
      platform.has(to) ||
      prepared.recipient.address !== to ||
      (expected.recipient !== null && expected.recipient !== to)
    ) {
      throw new NftCallError(
        'recipient',
        'The recipient does not match the address you confirmed. Nothing was signed.'
      )
    }
    return
  }
  throw new NftCallError('action', 'The prepared action does not match.')
}

let spec: NftClient['spec'] | null = null
function nftSpec(contractId: string, networkPassphrase: string) {
  // The spec is the same for every NFT instance; no network is contacted.
  spec ??= new NftClient({
    contractId,
    networkPassphrase,
    rpcUrl: 'http://localhost',
    allowHttp: true,
  }).spec
  return spec
}

function hexBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

/** The NFT invocation for a prepared call: `mint(article_id)` or `transfer(from, to, token_id)`. */
export function nftContractCall(prepared: PreparedNftCall): ContractCall {
  let args: Record<string, unknown>
  if (prepared.action === 'mint') {
    if (!HEX_32.test(prepared.args.article_id)) {
      throw new NftCallError('article', 'article_id must be 32 bytes of hex')
    }
    args = { article_id: hexBytes(prepared.args.article_id) }
  } else {
    args = {
      from: prepared.args.from,
      to: prepared.args.to,
      token_id: prepared.args.token_id,
    }
  }
  const scArgs: xdr.ScVal[] = nftSpec(
    prepared.contractId,
    prepared.networkPassphrase
  ).funcArgsToScVals(prepared.method, args)
  return {
    contractId: prepared.contractId,
    method: prepared.method,
    args: scArgs,
    source: prepared.signer,
    maxTime: prepared.maxTime,
    networkPassphrase: prepared.networkPassphrase,
  }
}

// ---------------------------------------------------------------------------
// Recipient entry
// ---------------------------------------------------------------------------

export type RecipientProblem =
  /** Wrong characters for an address or a username. */
  | 'format'
  /** Starts like an address but has the wrong length. */
  | 'length'
  /** Right shape, failed checksum: a typo. */
  | 'checksum'
  /** A muxed M… address; the server refuses them. */
  | 'muxed'
  /** A secret key (S…). It is never sent anywhere. */
  | 'secret'
  /** The owner's own address. */
  | 'own'
  /** A QuillTip contract: the NFT would be lost. */
  | 'platform'

export type RecipientInput =
  | { kind: 'address'; address: string; isContract: boolean }
  | { kind: 'user'; username: string }

export type RecipientCheck =
  | { status: 'empty' }
  /** Possibly correct once finished; show no error while the user types. */
  | { status: 'incomplete'; problem: RecipientProblem; message: string }
  | { status: 'invalid'; problem: RecipientProblem; message: string }
  | { status: 'ok'; recipient: RecipientInput }

const ADDRESS_LENGTH = 56
const BASE32 = /^[A-Z2-7]+$/
const USERNAME = /^[A-Za-z0-9_-]{3,20}$/
const USERNAME_MIN = 3
const USERNAME_MAX = 20

export const RECIPIENT_COPY: Record<RecipientProblem, string> = {
  format:
    'Enter a Stellar address (G… or C…) or a QuillTip username such as @ada.',
  length: 'A Stellar address has 56 characters.',
  checksum: 'This isn’t a valid Stellar address. Check it for a typo.',
  muxed:
    'Muxed addresses (M…) can’t hold an NFT. Use the G… address the wallet shows.',
  secret:
    'This is a secret key. Don’t share it with anyone. Enter the public address (G…) instead.',
  own: 'This NFT is already in that wallet.',
  platform:
    'That address is a QuillTip contract. It can’t hold the NFT, so the NFT would be lost.',
}

function invalid(problem: RecipientProblem): RecipientCheck {
  return { status: 'invalid', problem, message: RECIPIENT_COPY[problem] }
}

/**
 * Classifies what the user typed in the recipient field. `incomplete` is for
 * an address still being typed: the form shows it only after the field
 * loses focus or on submit. Addresses are compared in capitals; Stellar
 * addresses are base32, so case carries no meaning.
 */
export function checkRecipient(
  raw: string,
  context: {
    /** The current owner's address (the signer). */
    owner?: string | null
    platformContracts?: readonly (string | null | undefined)[]
  } = {}
): RecipientCheck {
  const value = raw.trim()
  if (!value) return { status: 'empty' }
  if (value.startsWith('@')) {
    const username = value.slice(1)
    return USERNAME.test(username)
      ? { status: 'ok', recipient: { kind: 'user', username } }
      : invalid('format')
  }
  const upper = value.toUpperCase()
  const first = upper[0]
  const keyLike =
    (first === 'G' || first === 'C' || first === 'M' || first === 'S') &&
    BASE32.test(upper)
  // Usernames have 3 to 20 characters; addresses 56 (G, C) or 69 (M).
  // A short run of capitals that starts like a key is an address being
  // typed; a username that looks like that needs its "@".
  const typingKey =
    keyLike && first !== 'S' && value === upper && value.length >= 5
  if (value.length <= USERNAME_MAX && !typingKey) {
    if (value.length < USERNAME_MIN) {
      return {
        status: 'incomplete',
        problem: 'format',
        message: RECIPIENT_COPY.format,
      }
    }
    return USERNAME.test(value)
      ? { status: 'ok', recipient: { kind: 'user', username: value } }
      : invalid('format')
  }
  if (!keyLike) return invalid('format')
  if (first === 'S') {
    return StrKey.isValidEd25519SecretSeed(upper) ||
      upper.length <= ADDRESS_LENGTH
      ? invalid('secret')
      : invalid('length')
  }
  if (first === 'M') {
    // Muxed addresses are 69 characters.
    if (StrKey.isValidMed25519PublicKey(upper)) return invalid('muxed')
    return upper.length < 69
      ? { status: 'incomplete', problem: 'muxed', message: RECIPIENT_COPY.muxed }
      : invalid('checksum')
  }
  if (upper.length < ADDRESS_LENGTH) {
    return {
      status: 'incomplete',
      problem: 'length',
      message: `${RECIPIENT_COPY.length} This one has ${upper.length}.${
        upper.length <= USERNAME_MAX ? ' For a username, start with @.' : ''
      }`,
    }
  }
  if (upper.length > ADDRESS_LENGTH) {
    return {
      status: 'invalid',
      problem: 'length',
      message: `${RECIPIENT_COPY.length} This one has ${upper.length}.`,
    }
  }
  const isContract = first === 'C'
  const valid = isContract
    ? StrKey.isValidContract(upper)
    : StrKey.isValidEd25519PublicKey(upper)
  if (!valid) return invalid('checksum')
  if (context.owner && upper === context.owner) return invalid('own')
  if ((context.platformContracts ?? []).some((id) => id && id === upper)) {
    return invalid('platform')
  }
  return {
    status: 'ok',
    recipient: { kind: 'address', address: upper, isContract },
  }
}

/** The G… account behind a muxed address, for help copy. Null if invalid. */
export function muxedBaseAccount(address: string): string | null {
  try {
    return MuxedAccount.fromAddress(address.trim().toUpperCase(), '0')
      .baseAccount()
      .accountId()
  } catch {
    return null
  }
}

/** "GBZX MADI …": groups of four, for reading an address aloud or checking it. */
export function groupAddress(address: string, size = 4): string[] {
  const groups: string[] = []
  for (let i = 0; i < address.length; i += size) {
    groups.push(address.slice(i, i + size))
  }
  return groups
}
