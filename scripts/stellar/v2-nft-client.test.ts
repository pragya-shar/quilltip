/**
 * Client modules for the v2 article NFT (docs/architecture/v2/05-flows-and-admin.md,
 * section 5.10): the call builders, the prepared-call checks, recipient
 * entry and the action runner. RPC and the wallet are fakes; nothing is
 * sent to a network.
 */
import {
  Account,
  Keypair,
  MuxedAccount,
  Networks,
  SorobanDataBuilder,
  StrKey,
  TransactionBuilder,
  scValToNative,
  xdr,
  type Transaction,
  type rpc,
} from '@stellar/stellar-sdk'
import { describe, expect, it, vi } from 'vitest'
import {
  NftCallError,
  checkPreparedNftCall,
  checkRecipient,
  groupAddress,
  muxedBaseAccount,
  nftContractCall,
  type NftCallExpectation,
  type PreparedNftMint,
  type PreparedNftTransfer,
} from '../../lib/stellar/v2/nft-calls'
import {
  recordFor,
  runNftCall,
  type NftRunDeps,
} from '../../lib/stellar/v2/nft-actions'
import type { RpcLike } from '../../lib/stellar/v2/tx'
import { WalletError } from '../../lib/stellar/v2/wallet-errors'

const NFT = 'CCOJOXITZQM7R6FSFPICN4Y3GONM4TN4Y6QV64CARDHNNRUT3U5SCYT7'
const CORE = 'CAFCGOIM6SKVBWCPFQODN22MY5HUJEJMW5AOMNGAOVZ4QBLJJ5RLOOMS'
const TAB = 'CBNBJ5PFFQ2XG3C7PQLPR3HA4ERHZ6FP3FUTYS3PXTZJZHRNZVDYTC45'
const XLM = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'
const OTHER_CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 7))
const owner = Keypair.random()
const OWNER = owner.publicKey()
const RECIPIENT = Keypair.random().publicKey()
const KEY = 'ab'.repeat(32)
const NOW = 1_800_000_000_000
const MAX_TIME = NOW / 1000 + 300

function mint(extra: Partial<PreparedNftMint> = {}): PreparedNftMint {
  return {
    submissionId: 'sub-mint',
    existing: false,
    network: 'TESTNET',
    networkPassphrase: Networks.TESTNET,
    contractId: NFT,
    maxTime: MAX_TIME,
    signer: OWNER,
    action: 'mint',
    method: 'mint',
    args: { article_id: KEY },
    articleId: 'k17article',
    articleKey: KEY,
    ...extra,
  }
}

function transfer(
  extra: Partial<PreparedNftTransfer> = {},
  args: Partial<PreparedNftTransfer['args']> = {}
): PreparedNftTransfer {
  return {
    submissionId: 'sub-transfer',
    existing: false,
    network: 'TESTNET',
    networkPassphrase: Networks.TESTNET,
    contractId: NFT,
    maxTime: MAX_TIME,
    signer: OWNER,
    action: 'transfer',
    method: 'transfer',
    args: { from: OWNER, to: RECIPIENT, token_id: 4, ...args },
    nftId: 'nft-1',
    tokenId: 4,
    recipient: {
      address: args.to ?? RECIPIENT,
      userId: null,
      username: null,
    },
    ...extra,
  }
}

const base = {
  networkPassphrase: Networks.TESTNET,
  nftContractId: NFT,
  platformContracts: [CORE, TAB, XLM],
  now: NOW,
}
const expectMint: NftCallExpectation = {
  ...base,
  action: 'mint',
  articleId: 'k17article',
}
const expectTransfer: NftCallExpectation = {
  ...base,
  action: 'transfer',
  nftId: 'nft-1',
  tokenId: 4,
  owner: OWNER,
  recipient: RECIPIENT,
}

function checkFails(
  prepared: PreparedNftMint | PreparedNftTransfer,
  expected: NftCallExpectation
): string {
  try {
    checkPreparedNftCall(prepared, expected)
  } catch (error) {
    expect(error).toBeInstanceOf(NftCallError)
    return (error as NftCallError).check
  }
  throw new Error('check passed')
}

describe('nftContractCall', () => {
  it('encodes mint(article_id) from the prepared hex', () => {
    const call = nftContractCall(mint())
    expect(call).toMatchObject({
      contractId: NFT,
      method: 'mint',
      source: OWNER,
      maxTime: MAX_TIME,
      networkPassphrase: Networks.TESTNET,
    })
    expect(call.args).toHaveLength(1)
    const bytes = scValToNative(call.args[0]!) as Buffer
    expect(Buffer.from(bytes).toString('hex')).toBe(KEY)
  })

  it('encodes transfer(from, to, token_id) as addresses and a u32', () => {
    const call = nftContractCall(transfer())
    expect(call.method).toBe('transfer')
    expect(call.args.map((v) => scValToNative(v))).toEqual([
      OWNER,
      RECIPIENT,
      4,
    ])
    // token_id is a u32, not an i128 or a u64.
    expect(call.args[2]!.toXDR('base64')).toBe(
      xdr.ScVal.scvU32(4).toXDR('base64')
    )
  })

  it('encodes a contract recipient', () => {
    const call = nftContractCall(transfer({}, { to: OTHER_CONTRACT }))
    expect(scValToNative(call.args[1]!)).toBe(OTHER_CONTRACT)
  })

  it('refuses an article_id that is not 32 bytes of hex', () => {
    expect(() => nftContractCall(mint({ args: { article_id: 'zz' } }))).toThrow(
      NftCallError
    )
  })
})

describe('checkPreparedNftCall', () => {
  it('accepts a matching mint and transfer', () => {
    expect(() => checkPreparedNftCall(mint(), expectMint)).not.toThrow()
    expect(() => checkPreparedNftCall(transfer(), expectTransfer)).not.toThrow()
  })

  it('refuses another network, contract or signer', () => {
    expect(
      checkFails(mint({ networkPassphrase: Networks.PUBLIC }), expectMint)
    ).toBe('network')
    expect(checkFails(mint({ contractId: CORE }), expectMint)).toBe('contract')
    expect(checkFails(mint(), { ...expectMint, nftContractId: null })).toBe(
      'contract'
    )
    expect(checkFails(mint({ signer: NFT }), expectMint)).toBe('signer')
  })

  it('refuses a prepared call past its time bound', () => {
    expect(checkFails(mint({ maxTime: NOW / 1000 }), expectMint)).toBe(
      'expired'
    )
  })

  it('refuses a mint for another article or key', () => {
    expect(checkFails(mint({ articleId: 'k17other' }), expectMint)).toBe(
      'article'
    )
    expect(
      checkFails(mint({ args: { article_id: 'cd'.repeat(32) } }), expectMint)
    ).toBe('article')
    expect(checkFails(mint({ action: 'transfer' } as never), expectMint)).toBe(
      'action'
    )
  })

  it('refuses a transfer of another token', () => {
    expect(checkFails(transfer({}, { token_id: 5 }), expectTransfer)).toBe(
      'token'
    )
    expect(checkFails(transfer({ nftId: 'nft-2' }), expectTransfer)).toBe(
      'token'
    )
    expect(
      checkFails(transfer({}, { token_id: -1 }), {
        ...expectTransfer,
        tokenId: -1,
      })
    ).toBe('token')
  })

  it('refuses a transfer from a wallet that is not the owner', () => {
    const other = Keypair.random().publicKey()
    expect(
      checkFails(transfer({ signer: other }, { from: other }), expectTransfer)
    ).toBe('owner')
    expect(checkFails(transfer({}, { from: other }), expectTransfer)).toBe(
      'owner'
    )
  })

  it('refuses a recipient other than the one confirmed', () => {
    const swapped = Keypair.random().publicKey()
    expect(checkFails(transfer({}, { to: swapped }), expectTransfer)).toBe(
      'recipient'
    )
    // The response's recipient block disagrees with the call arguments.
    expect(
      checkFails(
        transfer({
          recipient: { address: swapped, userId: null, username: null },
        }),
        expectTransfer
      )
    ).toBe('recipient')
  })

  it('refuses platform contracts, the owner itself and muxed recipients', () => {
    for (const to of [NFT, CORE, TAB, XLM, OWNER]) {
      expect(
        checkFails(transfer({}, { to }), { ...expectTransfer, recipient: null })
      ).toBe('recipient')
    }
    const muxed = new MuxedAccount(new Account(RECIPIENT, '0'), '7').accountId()
    expect(
      checkFails(transfer({}, { to: muxed }), {
        ...expectTransfer,
        recipient: null,
      })
    ).toBe('recipient')
  })

  it('accepts the server-resolved address for a username recipient', () => {
    expect(() =>
      checkPreparedNftCall(
        transfer({
          recipient: { address: RECIPIENT, userId: 'u1', username: 'ada' },
        }),
        { ...expectTransfer, recipient: null }
      )
    ).not.toThrow()
  })
})

describe('checkRecipient', () => {
  const ctx = { owner: OWNER, platformContracts: [NFT, CORE, TAB, XLM] }

  it('is empty for blank input', () => {
    expect(checkRecipient('   ', ctx)).toEqual({ status: 'empty' })
  })

  it('accepts account and contract addresses, in any case', () => {
    expect(checkRecipient(RECIPIENT, ctx)).toEqual({
      status: 'ok',
      recipient: { kind: 'address', address: RECIPIENT, isContract: false },
    })
    expect(checkRecipient(` ${RECIPIENT.toLowerCase()} `, ctx)).toMatchObject({
      status: 'ok',
      recipient: { address: RECIPIENT },
    })
    expect(checkRecipient(OTHER_CONTRACT, ctx)).toMatchObject({
      status: 'ok',
      recipient: { kind: 'address', isContract: true },
    })
  })

  it('treats an address being typed as incomplete, not invalid', () => {
    const partial = RECIPIENT.slice(0, 30)
    expect(checkRecipient(partial, ctx)).toMatchObject({
      status: 'incomplete',
      problem: 'length',
    })
    expect(checkRecipient(RECIPIENT.slice(0, 6), ctx)).toMatchObject({
      status: 'incomplete',
      problem: 'length',
    })
  })

  it('refuses a typo, an extra character and stray symbols', () => {
    const typo =
      RECIPIENT.slice(0, 20) +
      (RECIPIENT[20] === 'A' ? 'B' : 'A') +
      RECIPIENT.slice(21)
    expect(checkRecipient(typo, ctx)).toMatchObject({
      status: 'invalid',
      problem: 'checksum',
    })
    expect(checkRecipient(RECIPIENT + 'A', ctx)).toMatchObject({
      status: 'invalid',
      problem: 'length',
    })
    expect(checkRecipient('ada lovelace!', ctx)).toMatchObject({
      status: 'invalid',
      problem: 'format',
    })
  })

  it('refuses the owner, the platform contracts and muxed addresses', () => {
    expect(checkRecipient(OWNER, ctx)).toMatchObject({ problem: 'own' })
    for (const id of [NFT, CORE, TAB, XLM]) {
      expect(checkRecipient(id, ctx)).toMatchObject({
        status: 'invalid',
        problem: 'platform',
      })
    }
    const muxed = new MuxedAccount(new Account(RECIPIENT, '0'), '7').accountId()
    expect(checkRecipient(muxed, ctx)).toMatchObject({
      status: 'invalid',
      problem: 'muxed',
    })
    expect(muxedBaseAccount(muxed)).toBe(RECIPIENT)
    expect(muxedBaseAccount('nope')).toBeNull()
  })

  it('warns about a secret key without echoing it', () => {
    const result = checkRecipient(Keypair.random().secret(), ctx)
    expect(result).toMatchObject({ status: 'invalid', problem: 'secret' })
    expect(JSON.stringify(result)).not.toMatch(/S[A-Z2-7]{55}/)
  })

  it('reads usernames, with or without @', () => {
    expect(checkRecipient('@ada_l', ctx)).toEqual({
      status: 'ok',
      recipient: { kind: 'user', username: 'ada_l' },
    })
    expect(checkRecipient('Christopher', ctx)).toMatchObject({
      recipient: { kind: 'user', username: 'Christopher' },
    })
    // A short all-capitals run that starts like a key is an address being
    // typed; the "@" form names the user.
    expect(checkRecipient('GSTAR', ctx)).toMatchObject({ status: 'incomplete' })
    expect(checkRecipient('@GSTAR', ctx)).toMatchObject({ status: 'ok' })
    expect(checkRecipient('SAMUEL', ctx)).toMatchObject({
      recipient: { kind: 'user' },
    })
    expect(checkRecipient('@a', ctx)).toMatchObject({ status: 'invalid' })
  })

  it('groups an address in fours for checking', () => {
    const groups = groupAddress(RECIPIENT)
    expect(groups).toHaveLength(14)
    expect(groups.join('')).toBe(RECIPIENT)
  })
})

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

function errorEvent(contractId: string, code: number) {
  return {
    in_successful_contract_call: false,
    event: {
      contract_id: contractId,
      type: 'diagnostic',
      body: {
        v0: { topics: [{ symbol: 'error' }, { error: { contract: code } }] },
      },
    },
  }
}

const simulated = {
  id: '1',
  latestLedger: 1,
  _parsed: true,
  events: [],
  transactionData: new SorobanDataBuilder(),
  minResourceFee: '0',
  result: { auth: [], retval: xdr.ScVal.scvVoid() },
} as unknown as rpc.Api.SimulateTransactionResponse

function simulationError(contractId: string, code: number) {
  return {
    id: '1',
    latestLedger: 1,
    _parsed: true,
    events: [errorEvent(contractId, code)],
    error: `HostError: Error(Contract, #${code})`,
  } as unknown as rpc.Api.SimulateTransactionResponse
}

function fakeServer(
  overrides: Partial<Record<keyof RpcLike, unknown>> = {}
): RpcLike {
  return {
    getAccount: async (id: string) => new Account(id, '1'),
    simulateTransaction: async () => simulated,
    sendTransaction: async () => ({ status: 'PENDING', hash: '' }),
    getTransaction: async () => ({ status: 'NOT_FOUND' }),
    ...overrides,
  } as unknown as RpcLike
}

function deps(extra: Partial<NftRunDeps> = {}): NftRunDeps & {
  recorded: Array<{ kind: string; args: unknown[] }>
  phases: string[]
} {
  const recorded: Array<{ kind: string; args: unknown[] }> = []
  const phases: string[] = []
  return {
    prepared: transfer(),
    expected: expectTransfer,
    server: fakeServer(),
    contracts: { core: CORE, tab: TAB, nft: NFT, token: XLM },
    connect: async () => OWNER,
    sign: async (xdr) => {
      const tx = TransactionBuilder.fromXDR(
        xdr,
        Networks.TESTNET
      ) as Transaction
      tx.sign(owner)
      return tx.toXDR()
    },
    recordSubmitted: async (...args) => {
      recorded.push({ kind: 'submitted', args })
    },
    recordFailed: async (...args) => {
      recorded.push({ kind: 'failed', args })
    },
    onPhase: (phase) => phases.push(phase),
    recorded,
    phases,
    ...extra,
  }
}

describe('runNftCall', () => {
  it('builds, signs, sends and records the hash of a transfer', async () => {
    vi.setSystemTime(NOW)
    const d = deps()
    const result = await runNftCall(d)
    expect(result.status).toBe('sent')
    expect(d.phases).toEqual([
      'connecting',
      'simulating',
      'signing',
      'sending',
      'recording',
    ])
    expect(d.recorded).toEqual([
      {
        kind: 'submitted',
        args: ['sub-transfer', (result as { hash: string }).hash],
      },
    ])
    vi.useRealTimers()
  })

  it('records a local check failure and never asks the wallet', async () => {
    const connect = vi.fn(async () => OWNER)
    const d = deps({
      connect,
      prepared: transfer({}, { to: Keypair.random().publicKey() }),
    })
    const result = await runNftCall(d)
    expect(result).toMatchObject({ status: 'check_failed', check: 'recipient' })
    expect(connect).not.toHaveBeenCalled()
    expect(d.recorded).toEqual([
      {
        kind: 'failed',
        args: ['sub-transfer', 'wallet_rejected', 'client_check'],
      },
    ])
  })

  it('records a closed picker as cancelled', async () => {
    const d = deps({ connect: async () => null })
    const result = await runNftCall(d)
    expect(result).toMatchObject({
      status: 'wallet_failed',
      error: { kind: 'cancelled' },
    })
    expect(d.recorded[0]!.args).toEqual([
      'sub-transfer',
      'wallet_rejected',
      'cancelled',
    ])
  })

  it('refuses a wallet on another account', async () => {
    const d = deps({ connect: async () => RECIPIENT })
    const result = await runNftCall(d)
    expect(result).toMatchObject({
      status: 'wallet_failed',
      error: { kind: 'wrong-account' },
    })
  })

  it('maps connect errors to wallet failures', async () => {
    const locked = await runNftCall(
      deps({
        connect: async () => {
          throw new WalletError('locked', 'locked')
        },
      })
    )
    expect(locked).toMatchObject({ error: { kind: 'locked' } })
    const other = await runNftCall(
      deps({
        connect: async () => {
          throw new Error('boom')
        },
      })
    )
    expect(other).toMatchObject({ error: { kind: 'failed' } })
  })

  it('records a wallet refusal while signing', async () => {
    const d = deps({
      sign: async () => {
        throw new WalletError('rejected', 'no')
      },
    })
    const result = await runNftCall(d)
    expect(result).toMatchObject({
      status: 'wallet_failed',
      error: { kind: 'rejected' },
    })
    expect(d.recorded[0]!.args).toEqual([
      'sub-transfer',
      'wallet_rejected',
      'rejected',
    ])
  })

  it('records a simulation failure with the contract error name', async () => {
    const d = deps({
      prepared: mint(),
      expected: expectMint,
      server: fakeServer({
        simulateTransaction: async () => simulationError(NFT, 70),
      }),
    })
    const result = await runNftCall(d)
    expect(result).toMatchObject({
      status: 'simulation_failed',
      error: { name: 'BelowThreshold' },
    })
    expect(d.recorded[0]!.args).toEqual([
      'sub-mint',
      'simulation_failed',
      'BelowThreshold',
    ])
  })

  it('records a send error', async () => {
    const d = deps({
      server: fakeServer({
        sendTransaction: async () => ({
          status: 'ERROR',
          hash: '',
          errorResult: { result: () => ({}) },
        }),
      }),
    })
    const result = await runNftCall(d)
    expect(result.status).toBe('send_error')
    expect(d.recorded[0]!.kind).toBe('failed')
    expect(d.recorded[0]!.args[1]).toBe('send_error')
  })

  it('still returns sent when recording the hash fails', async () => {
    const d = deps({
      recordSubmitted: async () => {
        throw new Error('offline')
      },
    })
    expect((await runNftCall(d)).status).toBe('sent')
  })
})

describe('recordFor', () => {
  it('matches the payment kit mapping', () => {
    expect(recordFor({ status: 'sent', hash: 'h' })).toBeNull()
    expect(recordFor({ status: 'not_sent', detail: 'x' })).toEqual({
      reason: 'send_error',
      detail: 'TRY_AGAIN_LATER',
    })
    expect(
      recordFor({
        status: 'wallet_failed',
        error: new WalletError('timeout', 't'),
      })
    ).toEqual({ reason: 'wallet_rejected', detail: 'timeout' })
  })
})
