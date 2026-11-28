/**
 * What the fee sponsor agrees to pay for, as pure checks (no network). Each
 * refusal has a test in `scripts/chain/sponsor-policy.test.ts`; the threat
 * list is in the pull request that added this module.
 *
 * The sponsor is the transaction source and fee payer for calls that a
 * passkey account (a contract address) authorizes with its own signature. It
 * is never a signer on a reader's account. It pays for two things only:
 * 1. a balance call on the configured Tab for the caller's own passkey
 *    account (`balanceCallArgs` builds it; nothing comes from a client);
 * 2. the birth of a passkey account through the allowlisted deployer and
 *    account WASM, with the allowlisted verifier and the verified passkey as
 *    its only signer (`checkDeployPayload`).
 */
import {
  Address,
  BASE_FEE,
  Keypair,
  StrKey,
  hash,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk'
import { Buffer } from 'buffer'
import { assertBackendTestnet } from '../networkGuard'

export type SponsoredCall =
  | 'open_session'
  | 'deposit'
  | 'register_key'
  | 'revoke_key'

export const SPONSORED_CALLS: readonly SponsoredCall[] = [
  'open_session',
  'deposit',
  'register_key',
  'revoke_key',
]

/**
 * Resource fee caps in stroops, checked after simulation with the real
 * signatures. Measured on testnet (2026-11-28): a first `open_session` from
 * 1,163,817 to 1,374,167; a renewal on an existing balance about 80,000; an
 * account deploy about 198,000. A first `deposit` or `register_key` creates
 * the reader's balance entry and costs about what a first `open_session`
 * does, so they share its cap; `revoke_key` writes no new entry.
 */
export const RESOURCE_FEE_CAP: Record<SponsoredCall, bigint> = {
  open_session: BigInt(2_000_000),
  deposit: BigInt(2_000_000),
  register_key: BigInt(2_000_000),
  revoke_key: BigInt(600_000),
}
export const DEPLOY_RESOURCE_FEE_CAP = BigInt(400_000)

/**
 * What a request commits against the day's budget until its result is known:
 * the most its envelope may cost (the resource cap plus the inclusion fee),
 * never the smaller simulated fee.
 */
export function commitStroops(call: SponsoredCall | 'deploy'): bigint {
  const cap =
    call === 'deploy' ? DEPLOY_RESOURCE_FEE_CAP : RESOURCE_FEE_CAP[call]
  return cap + BigInt(BASE_FEE)
}

/** A readiness result counts for this long; older reads as not checked. */
export const READINESS_TTL_MS = 15 * 60_000
/** How long one caller may hold the readiness check before another may run it. */
export const READINESS_LEASE_MS = 30_000

/**
 * The deployer `smart-account-kit` derives from its public seed. Accounts are
 * deployed through it; `SPONSOR_ACCOUNT_DEPLOYER` must equal it.
 */
export function kitDefaultDeployer(): string {
  return Keypair.fromRawEd25519Seed(
    hash(Buffer.from('openzeppelin-smart-account-kit'))
  ).publicKey()
}
/** A prepared request is refused after this. */
export const REQUEST_TTL_MS = 5 * 60_000
/** Signatures must expire no later than the prepared ledger plus this. */
export const SIGNATURE_EXPIRY_LEDGERS = 120
/** Sponsored balance calls per user. */
export const PER_USER_PER_HOUR = 6
export const PER_USER_PER_DAY = 20
/** Default fee budget per UTC day for all users, in stroops (2,000 XLM). */
export const DEFAULT_DAILY_BUDGET_STROOPS = BigInt(20_000_000_000)
/** Default floor: below this the sponsor refuses and logs an alert (100 XLM). */
export const DEFAULT_MIN_BALANCE_STROOPS = BigInt(1_000_000_000)

export class SponsorRefusal extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'SponsorRefusal'
  }
}

export function refuse(code: string, message: string): never {
  throw new SponsorRefusal(code, message)
}

// ----- Configuration -----

type EnvLike = Record<string, string | undefined>

export type SponsorConfig = {
  tabContractId: string
  tokenContractId: string
  dailyBudgetStroops: bigint
  minBalanceStroops: bigint
  accountWasmHash: string | null
  accountDeployer: string | null
  /** The WebAuthn verifier contract an account's one signer must name. */
  accountVerifier: string | null
  /** The sponsor's public address: the secret must derive exactly this. */
  publicKey: string
}

function stroopsSetting(env: EnvLike, name: string, fallback: bigint): bigint {
  const raw = env[name]?.trim()
  if (!raw) return fallback
  if (!/^[1-9][0-9]{0,18}$/.test(raw)) {
    refuse(
      'SPONSOR_CONFIG_INVALID',
      `${name} is not a whole number of stroops.`
    )
  }
  return BigInt(raw)
}

/**
 * The guarded settings, in order: testnet only, then `SPONSOR_ENABLED=true`,
 * then the contracts. The secret is read separately (`sponsorSecret`), and
 * only after this passed.
 */
export function sponsorConfig(env: EnvLike = process.env): SponsorConfig {
  assertBackendTestnet(env)
  if (env.SPONSOR_ENABLED?.trim() !== 'true') {
    refuse('SPONSOR_DISABLED', 'The fee sponsor is off.')
  }
  const tab = env.TAB_CONTRACT_ID?.trim() ?? ''
  const token = env.TOKEN_CONTRACT_ID?.trim() ?? ''
  if (!StrKey.isValidContract(tab) || !StrKey.isValidContract(token)) {
    refuse(
      'SPONSOR_CONFIG_INVALID',
      'TAB_CONTRACT_ID and TOKEN_CONTRACT_ID must be contract addresses.'
    )
  }
  // Required: without the allowlist the sponsor would pay for readers whose
  // account code is unknown, and deploys could not be checked.
  const wasm = env.SPONSOR_ACCOUNT_WASM_HASH?.trim().toLowerCase() ?? ''
  if (!/^[0-9a-f]{64}$/.test(wasm)) {
    refuse('SPONSOR_CONFIG_INVALID', 'SPONSOR_ACCOUNT_WASM_HASH is not a hash.')
  }
  const deployer = env.SPONSOR_ACCOUNT_DEPLOYER?.trim() ?? ''
  if (!StrKey.isValidEd25519PublicKey(deployer)) {
    refuse(
      'SPONSOR_CONFIG_INVALID',
      'SPONSOR_ACCOUNT_DEPLOYER is not an account address.'
    )
  }
  const verifier = env.SPONSOR_ACCOUNT_VERIFIER?.trim() ?? ''
  if (!StrKey.isValidContract(verifier)) {
    refuse(
      'SPONSOR_CONFIG_INVALID',
      'SPONSOR_ACCOUNT_VERIFIER is not a contract address.'
    )
  }
  const publicKey = env.SPONSOR_PUBLIC_KEY?.trim() ?? ''
  if (!StrKey.isValidEd25519PublicKey(publicKey)) {
    refuse(
      'SPONSOR_CONFIG_INVALID',
      'SPONSOR_PUBLIC_KEY is not an account address.'
    )
  }
  return {
    tabContractId: tab,
    tokenContractId: token,
    dailyBudgetStroops: stroopsSetting(
      env,
      'SPONSOR_DAILY_BUDGET_STROOPS',
      DEFAULT_DAILY_BUDGET_STROOPS
    ),
    minBalanceStroops: stroopsSetting(
      env,
      'SPONSOR_MIN_BALANCE_STROOPS',
      DEFAULT_MIN_BALANCE_STROOPS
    ),
    accountWasmHash: wasm,
    accountDeployer: deployer,
    accountVerifier: verifier,
    publicKey,
  }
}

/** Reads `SPONSOR_SECRET`. Call only after `sponsorConfig` passed. Never log it. */
export function sponsorSecret(env: EnvLike = process.env): string {
  const secret = env.SPONSOR_SECRET?.trim()
  if (!secret || !StrKey.isValidEd25519SecretSeed(secret)) {
    refuse(
      'SPONSOR_UNAVAILABLE',
      'SPONSOR_SECRET is not a valid Stellar secret.'
    )
  }
  return secret
}

// ----- Balance calls -----

export type BalanceCallSpec = {
  call: SponsoredCall
  tabContractId: string
  tokenContractId: string
  /** The caller's own passkey account. */
  reader: string
  /** Stroops deposited; 0 when none. */
  amount: bigint
  key: { publicKey: string; validUntil: number; spendLimit: bigint } | null
  /** `revoke_key` only. */
  keyId: number | null
}

const addr = (a: string) => new Address(a).toScVal()
const i128 = (n: bigint) => nativeToScVal(n, { type: 'i128' })
const u32 = (n: number) => nativeToScVal(n, { type: 'u32' })
const bytes32 = (hex: string) => xdr.ScVal.scvBytes(Buffer.from(hex, 'hex'))

/** Checks the shape of a spec before anything is built from it. */
export function checkSpec(spec: BalanceCallSpec): void {
  if (!SPONSORED_CALLS.includes(spec.call)) {
    refuse('SPONSOR_CALL_NOT_ALLOWED', 'That call is not sponsored.')
  }
  if (!StrKey.isValidContract(spec.reader)) {
    refuse('SPONSOR_READER_NOT_PASSKEY', 'Only a passkey account is sponsored.')
  }
  if (spec.amount < BigInt(0)) refuse('SPONSOR_INVALID', 'Invalid amount.')
  const needsKey = spec.call === 'open_session' || spec.call === 'register_key'
  if (needsKey !== (spec.key !== null)) {
    refuse('SPONSOR_INVALID', 'The device key does not fit this call.')
  }
  if (spec.key) {
    if (
      !/^[0-9a-f]{64}$/.test(spec.key.publicKey) ||
      /^0+$/.test(spec.key.publicKey)
    ) {
      refuse('SPONSOR_INVALID', 'Invalid device key.')
    }
    if (!Number.isInteger(spec.key.validUntil) || spec.key.validUntil <= 0) {
      refuse('SPONSOR_INVALID', 'Invalid key expiry ledger.')
    }
    if (spec.key.spendLimit <= BigInt(0)) {
      refuse('SPONSOR_INVALID', 'The cap must be above zero.')
    }
  }
  if (spec.call === 'deposit' && spec.amount === BigInt(0)) {
    refuse('SPONSOR_INVALID', 'A deposit needs an amount.')
  }
  if (
    (spec.call === 'register_key' || spec.call === 'revoke_key') &&
    spec.amount !== BigInt(0)
  ) {
    refuse('SPONSOR_INVALID', 'This call moves no money.')
  }
  if (
    spec.call === 'revoke_key' &&
    (spec.keyId === null || !Number.isInteger(spec.keyId) || spec.keyId < 0)
  ) {
    refuse('SPONSOR_INVALID', 'Invalid key id.')
  }
}

/** The Tab invocation for a spec: the only way a sponsored call is built. */
export function balanceCallArgs(spec: BalanceCallSpec): {
  contract: string
  function: SponsoredCall
  args: xdr.ScVal[]
} {
  checkSpec(spec)
  const reader = addr(spec.reader)
  const key = spec.key
  let args: xdr.ScVal[]
  switch (spec.call) {
    case 'open_session':
      args = [
        reader,
        i128(spec.amount),
        bytes32(key!.publicKey),
        u32(key!.validUntil),
        i128(key!.spendLimit),
      ]
      break
    case 'deposit':
      args = [reader, i128(spec.amount)]
      break
    case 'register_key':
      args = [
        reader,
        bytes32(key!.publicKey),
        u32(key!.validUntil),
        i128(key!.spendLimit),
      ]
      break
    case 'revoke_key':
      args = [reader, u32(spec.keyId!)]
      break
  }
  return { contract: spec.tabContractId, function: spec.call, args }
}

export function contractFn(
  contract: string,
  fn: string,
  args: xdr.ScVal[]
): xdr.SorobanAuthorizedFunction {
  return xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
    new xdr.InvokeContractArgs({
      contractAddress: new Address(contract).toScAddress(),
      functionName: fn,
      args,
    } as never)
  )
}

const b64 = (v: { toXDR(format: 'base64'): string }) => v.toXDR('base64')

type CredentialsUnion = { type: string; value: xdr.SorobanAddressCredentials }

/** The address credentials of an entry, or null for source-account credentials. */
export function addressCredentials(
  entry: xdr.SorobanAuthorizationEntry
): xdr.SorobanAddressCredentials | null {
  const creds = entry.credentials as unknown as CredentialsUnion
  if (
    creds.type === 'sorobanCredentialsAddress' ||
    creds.type === 'sorobanCredentialsAddressV2'
  ) {
    return creds.value
  }
  if (creds.type === 'sorobanCredentialsSourceAccount') return null
  refuse(
    'SPONSOR_AUTH_REFUSED',
    `Credentials of type ${creds.type} are not sponsored.`
  )
}

function countInvocations(inv: xdr.SorobanAuthorizedInvocation): number {
  return 1 + inv.subInvocations.reduce((n, s) => n + countInvocations(s), 0)
}

/**
 * Checks the auth entries a recording simulation returned for a balance call:
 * exactly one entry; address credentials for the reader; the root invocation
 * exactly the call that was built; and, when money moves, exactly one nested
 * invocation, the token transfer from the reader to the Tab of exactly the
 * amount. Returns how many contexts the passkey signs.
 */
export function checkRecordedAuth(
  entries: xdr.SorobanAuthorizationEntry[],
  spec: BalanceCallSpec
): { contexts: number } {
  if (entries.length !== 1) {
    refuse(
      'SPONSOR_AUTH_REFUSED',
      `Expected one auth entry, got ${entries.length}.`
    )
  }
  const entry = entries[0]!
  const creds = addressCredentials(entry)
  if (!creds) {
    refuse(
      'SPONSOR_AUTH_REFUSED',
      'Source-account credentials are never sponsored.'
    )
  }
  if (Address.fromScAddress(creds.address).toString() !== spec.reader) {
    refuse('SPONSOR_AUTH_REFUSED', 'The auth entry is for another address.')
  }
  const built = balanceCallArgs(spec)
  const root = entry.rootInvocation
  if (
    b64(root.function) !==
    b64(contractFn(built.contract, built.function, built.args))
  ) {
    refuse(
      'SPONSOR_AUTH_REFUSED',
      'The authorized call is not the one prepared.'
    )
  }
  const subs = root.subInvocations
  if (spec.amount === BigInt(0)) {
    if (subs.length !== 0)
      refuse('SPONSOR_AUTH_REFUSED', 'Unexpected nested call.')
  } else {
    if (subs.length !== 1) {
      refuse('SPONSOR_AUTH_REFUSED', 'Expected exactly one nested transfer.')
    }
    const transfer = contractFn(spec.tokenContractId, 'transfer', [
      addr(spec.reader),
      addr(spec.tabContractId),
      i128(spec.amount),
    ])
    if (
      b64(subs[0]!.function) !== b64(transfer) ||
      subs[0]!.subInvocations.length !== 0
    ) {
      refuse(
        'SPONSOR_AUTH_REFUSED',
        'The nested call is not the expected transfer.'
      )
    }
  }
  return { contexts: countInvocations(root) }
}

/**
 * Checks that signed entries are the prepared ones: the same credentials
 * type, address, nonce and invocation tree. Only the signature and its expiry
 * may differ, and the expiry may not pass `maxExpiration`.
 */
export function checkSignedMatchesPrepared(
  prepared: string[],
  signed: string[],
  maxExpiration: number
): xdr.SorobanAuthorizationEntry[] {
  if (prepared.length !== signed.length) {
    refuse(
      'SPONSOR_SIGNED_MISMATCH',
      'The signed entries do not match the request.'
    )
  }
  return signed.map((s, i) => {
    let entry: xdr.SorobanAuthorizationEntry
    try {
      entry = xdr.SorobanAuthorizationEntry.fromXDR(s, 'base64')
    } catch {
      refuse('SPONSOR_SIGNED_MISMATCH', 'A signed entry is not valid XDR.')
    }
    const before = xdr.SorobanAuthorizationEntry.fromXDR(prepared[i]!, 'base64')
    const a = addressCredentials(before)
    const b = addressCredentials(entry)
    if (!a || !b) {
      refuse(
        'SPONSOR_SIGNED_MISMATCH',
        'Source-account credentials are never sponsored.'
      )
    }
    const typeA = (before.credentials as unknown as CredentialsUnion).type
    const typeB = (entry.credentials as unknown as CredentialsUnion).type
    if (
      typeA !== typeB ||
      b64(a.address) !== b64(b.address) ||
      String(a.nonce) !== String(b.nonce) ||
      b64(before.rootInvocation) !== b64(entry.rootInvocation)
    ) {
      refuse(
        'SPONSOR_SIGNED_MISMATCH',
        'The signed entries do not match the request.'
      )
    }
    const expiry = Number(b.signatureExpirationLedger)
    if (!Number.isInteger(expiry) || expiry <= 0 || expiry > maxExpiration) {
      refuse('SPONSOR_SIGNED_MISMATCH', 'The signature expiry is out of range.')
    }
    return entry
  })
}

export function checkResourceFee(
  call: SponsoredCall | 'deploy',
  resourceFee: bigint
): void {
  const cap =
    call === 'deploy' ? DEPLOY_RESOURCE_FEE_CAP : RESOURCE_FEE_CAP[call]
  if (resourceFee > cap) {
    refuse(
      'SPONSOR_FEE_OVER_CAP',
      `The fee ${resourceFee} is over the cap ${cap}.`
    )
  }
}

// ----- Account birth -----

/** The contract address a contract-id preimage gives on a network. */
export function contractIdFor(
  preimage: xdr.ContractIdPreimage,
  passphrase: string
): string {
  const id = xdr.HashIdPreimage.envelopeTypeContractId(
    new xdr.HashIdPreimageContractId({
      networkId: hash(Buffer.from(passphrase)),
      contractIdPreimage: preimage,
    } as never)
  )
  return StrKey.encodeContract(hash(Buffer.from(id.toXDR())))
}

type Union<T> = { type: string; value: T }

/** A P-256 public key in uncompressed form: 0x04, then X and Y. */
const P256_KEY_BYTES = 65
/** WebAuthn credential ids are 16 to 1023 bytes. */
const MIN_CREDENTIAL_ID_BYTES = 16
const MAX_CREDENTIAL_ID_BYTES = 1023

/**
 * The constructor arguments a passkey account must be born with (the kit's
 * `buildDeployTransaction`): exactly one signer,
 * `External(verifier, signerKey)`, and no policies. `signerKey` is the
 * verified public key followed by the credential id.
 */
export function accountConstructorArgs(
  verifier: string,
  signerKey: Buffer
): xdr.ScVal[] {
  const signer = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol('External'),
    new Address(verifier).toScVal(),
    xdr.ScVal.scvBytes(signerKey),
  ])
  return [xdr.ScVal.scvVec([signer]), xdr.ScVal.scvMap([])]
}

/**
 * Reads the verified signer key (hex: the 65-byte uncompressed P-256 public
 * key, then the credential id). The policy does not tie the credential id to
 * the address: the salt is the caller's, and `expectedContractId` names the
 * address.
 */
function signerKeyBytes(hex: string): Buffer {
  const min = (P256_KEY_BYTES + MIN_CREDENTIAL_ID_BYTES) * 2
  const max = (P256_KEY_BYTES + MAX_CREDENTIAL_ID_BYTES) * 2
  if (
    !/^(?:[0-9a-f]{2})+$/.test(hex) ||
    hex.length < min ||
    hex.length > max ||
    !hex.startsWith('04')
  ) {
    refuse('SPONSOR_DEPLOY_REFUSED', 'The signer key is not a passkey key.')
  }
  return Buffer.from(hex, 'hex')
}

/**
 * Checks a passkey account's deploy payload (`{ func, auth }`, in the shape
 * of `smart-account-kit`'s `createWallet`): a `CreateContractV2` from the
 * allowlisted deployer with the allowlisted account WASM, giving
 * `expectedContractId`, whose constructor installs exactly one signer (the
 * allowlisted verifier and the verified `signerKey`) and no policies, and
 * authorized by that deployer only and for exactly that creation.
 */
export function checkDeployPayload(args: {
  func: string
  auth: string[]
  wasmHash: string
  deployer: string
  verifier: string
  signerKey: string
  expectedContractId: string
  passphrase: string
}): { func: xdr.HostFunction; auth: xdr.SorobanAuthorizationEntry[] } {
  let func: xdr.HostFunction
  let auth: xdr.SorobanAuthorizationEntry[]
  try {
    func = xdr.HostFunction.fromXDR(args.func, 'base64')
    auth = args.auth.map((a) =>
      xdr.SorobanAuthorizationEntry.fromXDR(a, 'base64')
    )
  } catch {
    refuse('SPONSOR_DEPLOY_REFUSED', 'The deploy payload is not valid XDR.')
  }
  const hf = func as unknown as Union<xdr.CreateContractArgsV2>
  if (hf.type !== 'hostFunctionTypeCreateContractV2') {
    refuse('SPONSOR_DEPLOY_REFUSED', 'Only a contract creation is sponsored.')
  }
  const create = hf.value
  // The WASM hash is a fixed 32-byte opaque: its XDR is the bytes themselves.
  const exe = create.executable as unknown as Union<{ toXDR(): Uint8Array }>
  if (
    exe.type !== 'contractExecutableWasm' ||
    Buffer.from(exe.value.toXDR()).toString('hex') !== args.wasmHash
  ) {
    refuse('SPONSOR_DEPLOY_REFUSED', 'That account code is not allowlisted.')
  }
  const pre =
    create.contractIdPreimage as unknown as Union<xdr.ContractIdPreimageFromAddress>
  if (
    pre.type !== 'contractIdPreimageFromAddress' ||
    Address.fromScAddress(pre.value.address).toString() !== args.deployer
  ) {
    refuse('SPONSOR_DEPLOY_REFUSED', 'That deployer is not allowlisted.')
  }
  if (
    contractIdFor(create.contractIdPreimage, args.passphrase) !==
    args.expectedContractId
  ) {
    refuse(
      'SPONSOR_DEPLOY_REFUSED',
      'The payload does not create the expected account.'
    )
  }
  // The deployer is public, so the code and address alone do not make an
  // account ours: its only signer must be the passkey that was verified.
  const signerKey = signerKeyBytes(args.signerKey)
  const expectedArgs = accountConstructorArgs(args.verifier, signerKey)
  const gotArgs = create.constructorArgs
  if (
    gotArgs.length !== expectedArgs.length ||
    gotArgs.some((a, i) => b64(a) !== b64(expectedArgs[i]!))
  ) {
    refuse(
      'SPONSOR_DEPLOY_REFUSED',
      'The account is not born with exactly the verified passkey as signer.'
    )
  }
  if (auth.length !== 1) {
    refuse(
      'SPONSOR_DEPLOY_REFUSED',
      'Expected one auth entry, from the deployer.'
    )
  }
  const creds = addressCredentials(auth[0]!)
  if (
    !creds ||
    Address.fromScAddress(creds.address).toString() !== args.deployer
  ) {
    refuse(
      'SPONSOR_DEPLOY_REFUSED',
      'Only the deployer may authorize the creation.'
    )
  }
  const root = auth[0]!.rootInvocation
  const fn = root.function as unknown as Union<xdr.CreateContractArgsV2>
  if (
    fn.type !== 'sorobanAuthorizedFunctionTypeCreateContractV2HostFn' ||
    b64(fn.value) !== b64(create) ||
    root.subInvocations.length !== 0
  ) {
    refuse('SPONSOR_DEPLOY_REFUSED', 'The deployer authorized something else.')
  }
  return { func, auth }
}
