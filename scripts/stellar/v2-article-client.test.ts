/**
 * Client modules for article registration (docs/architecture/v2/06-app-integration.md,
 * section 6.6): config, errors, split rules, the article call encoder and the
 * transaction lifecycle helpers. RPC and the wallet are fakes; nothing is
 * sent to a network.
 */
import {
  Account,
  Keypair,
  Networks,
  TransactionBuilder,
  rpc,
  scValToNative,
  type Transaction,
} from '@stellar/stellar-sdk'
import { describe, expect, it } from 'vitest'
import { CoreError } from '../../lib/stellar/v2/bindings/core'
import {
  NftError,
  NonFungibleTokenError,
} from '../../lib/stellar/v2/bindings/nft'
import { TabError } from '../../lib/stellar/v2/bindings/tab'
import {
  CONTRACT_ERRORS,
  contractErrorCode,
  contractErrorMessage,
  describeContractFailure,
} from '../../lib/stellar/v2/errors'
import { readV2Config } from '../../lib/stellar/v2/config'
import {
  ArticleCallError,
  articleContractCall,
  checkPreparedCall,
  type PreparedArticleCall,
} from '../../lib/stellar/v2/article-calls'
import { articleId, articleRef } from '../../lib/stellar/v2/ids'
import {
  articleIdHex,
  articleRefHex,
  bytesToHex,
} from '../../convex/lib/chain/ids'
import {
  bpsToPercent,
  percentToBps,
  splitProblems,
} from '../../convex/lib/chain/splits'
import {
  MAX_RESENDS,
  pollTransaction,
  sendContractCall,
  type RpcLike,
} from '../../lib/stellar/v2/tx'
import { WalletError } from '../../lib/stellar/v2/wallet-errors'

const CORE = 'CC7Q3HDXQHMSI2WUE6C2KC35TRLPL22T3WEGZ67AB7KK5PDDJHQPZMZY'
const signer = Keypair.random()
const SIGNER = signer.publicKey()
const COAUTHOR = Keypair.random().publicKey()
const CONVEX_ID = 'k17abc123article'

describe('errors', () => {
  it('maps every contract error code in the bindings', () => {
    for (const source of [CoreError, TabError, NftError]) {
      for (const [code, { message: name }] of Object.entries(source)) {
        const info = contractErrorMessage(Number(code))
        expect(info.name).toBe(name)
        expect(info.message.length).toBeGreaterThan(10)
      }
    }
    for (const code of Object.keys(NonFungibleTokenError)) {
      expect(CONTRACT_ERRORS.has(Number(code))).toBe(true)
    }
  })

  it('gives Core registration errors specific messages', () => {
    expect(contractErrorMessage(2)).toMatchObject({
      name: 'AlreadyRegistered',
      message: 'This article is already registered on Stellar.',
    })
    expect(contractErrorMessage(19).name).toBe('NoPendingAuthor')
    expect(contractErrorMessage(1000).name).toBe('EnforcedPause')
  })

  it('reads the code from a simulation message', () => {
    const text =
      'HostError: Error(Contract, #4)\n\nEvent log (newest first): ...'
    expect(contractErrorCode(text)).toBe(4)
    expect(describeContractFailure(text).name).toBe('InvalidSplits')
    expect(contractErrorCode('no code here')).toBeNull()
    expect(describeContractFailure('txInsufficientBalance').message).toMatch(
      /testnet XLM/
    )
  })

  it('falls back to a generic message for an unknown code', () => {
    expect(contractErrorMessage(9999)).toMatchObject({ name: null })
  })
})

describe('config', () => {
  it('accepts testnet with a Core contract', () => {
    const config = readV2Config({ network: 'TESTNET', coreContractId: CORE })
    expect(config).toMatchObject({
      network: 'TESTNET',
      passphrase: Networks.TESTNET,
      rpcUrl: 'https://soroban-testnet.stellar.org',
      coreContractId: CORE,
      allowHttp: false,
    })
  })

  it('refuses mainnet settings', () => {
    expect(() => readV2Config({ network: 'MAINNET' })).toThrow()
    expect(() =>
      readV2Config({ network: 'TESTNET', passphrase: Networks.PUBLIC })
    ).toThrow()
    expect(() =>
      readV2Config({
        network: 'TESTNET',
        rpcUrl: 'https://mainnet.sorobanrpc.com',
      })
    ).toThrow()
  })

  it('refuses an invalid contract ID', () => {
    expect(() =>
      readV2Config({ network: 'TESTNET', coreContractId: 'not-a-contract' })
    ).toThrow(/NEXT_PUBLIC_CORE_CONTRACT_ID/)
  })
})

describe('split rules', () => {
  it('accepts no splits or a valid list', () => {
    expect(splitProblems([], { author: SIGNER })).toEqual([])
    expect(
      splitProblems(
        [
          { recipient: SIGNER, bps: 7_500 },
          { recipient: COAUTHOR, bps: 2_500 },
        ],
        { author: SIGNER }
      )
    ).toEqual([])
  })

  it('refuses the treasury as a recipient', () => {
    const problems = splitProblems(
      [
        { recipient: SIGNER, bps: 5_000 },
        { recipient: COAUTHOR, bps: 5_000 },
      ],
      { author: SIGNER, treasury: COAUTHOR }
    )
    expect(problems.map((p) => p.code)).toEqual(['TREASURY'])
  })

  it('converts percentages and basis points', () => {
    expect(percentToBps('12.5')).toBe(1_250)
    expect(percentToBps('100')).toBe(10_000)
    expect(percentToBps('0.01')).toBe(1)
    expect(percentToBps('100.01')).toBeNull()
    expect(percentToBps('1.234')).toBeNull()
    expect(percentToBps('abc')).toBeNull()
    expect(bpsToPercent(1_250)).toBe('12.5')
    expect(bpsToPercent(10_000)).toBe('100')
    expect(bpsToPercent(1)).toBe('0.01')
  })
})

describe('article call encoder', () => {
  const ref = bytesToHex(articleRef(CONVEX_ID))
  const key = bytesToHex(articleId(SIGNER, articleRef(CONVEX_ID)))
  const base: PreparedArticleCall = {
    kind: 'register',
    contractId: CORE,
    networkPassphrase: Networks.TESTNET,
    maxTime: 1_900_000_000,
    signer: SIGNER,
    articleKey: key,
    articleRef: ref,
    author: SIGNER,
    contentHash: 'ab'.repeat(32),
    arweaveId: null,
    splits: [],
    newAuthor: null,
    liveUntilLedger: null,
  }
  const expected = {
    convexArticleId: CONVEX_ID,
    networkPassphrase: Networks.TESTNET,
    coreContractId: CORE,
  }

  it('agrees with the Convex encoders', async () => {
    expect(ref).toBe(await articleRefHex(CONVEX_ID))
    expect(key).toBe(await articleIdHex(SIGNER, ref))
  })

  it('encodes register_article with splits', () => {
    const call = articleContractCall({
      ...base,
      arweaveId: 'cd'.repeat(32),
      splits: [
        { recipient: SIGNER, bps: 6_000 },
        { recipient: COAUTHOR, bps: 4_000 },
      ],
    })
    expect(call.method).toBe('register_article')
    expect(call.source).toBe(SIGNER)
    const [author, articleRefArg, hash, arweave, splits] =
      call.args.map(scValToNative)
    expect(author).toBe(SIGNER)
    expect(bytesToHex(articleRefArg)).toBe(ref)
    expect(bytesToHex(hash)).toBe('ab'.repeat(32))
    expect(bytesToHex(arweave)).toBe('cd'.repeat(32))
    expect(splits).toEqual([
      { recipient: SIGNER, bps: 6_000 },
      { recipient: COAUTHOR, bps: 4_000 },
    ])
  })

  it('encodes the update and author calls', () => {
    const update = articleContractCall({
      ...base,
      kind: 'content_update',
      contentHash: 'ef'.repeat(32),
    })
    expect(update.method).toBe('update_content')
    const [id, hash, arweave] = update.args.map(scValToNative)
    expect(bytesToHex(id)).toBe(key)
    expect(bytesToHex(hash)).toBe('ef'.repeat(32))
    expect(arweave).toBeNull()

    const propose = articleContractCall({
      ...base,
      kind: 'author_propose',
      newAuthor: COAUTHOR,
      liveUntilLedger: 123_456,
    })
    expect(propose.method).toBe('propose_author')
    expect(propose.args.map(scValToNative).slice(1)).toEqual([
      COAUTHOR,
      123_456,
    ])

    const accept = articleContractCall({ ...base, kind: 'author_accept' })
    expect(accept.method).toBe('accept_author')
    expect(accept.args).toHaveLength(1)
  })

  it('refuses a prepared call for another network, contract or ID', () => {
    expect(() => checkPreparedCall(base, expected)).not.toThrow()
    expect(() =>
      checkPreparedCall(
        { ...base, networkPassphrase: Networks.PUBLIC },
        expected
      )
    ).toThrow(ArticleCallError)
    expect(() =>
      checkPreparedCall(base, { ...expected, coreContractId: null })
    ).toThrow(/another contract/)
    expect(() =>
      checkPreparedCall({ ...base, articleKey: 'ee'.repeat(32) }, expected)
    ).toThrow(/article ID/)
    expect(() =>
      checkPreparedCall(base, { ...expected, convexArticleId: 'other' })
    ).toThrow(/reference/)
  })
})

describe('transaction lifecycle', () => {
  const call = articleContractCall({
    kind: 'author_accept',
    contractId: CORE,
    networkPassphrase: Networks.TESTNET,
    maxTime: 2_000_000_000,
    signer: SIGNER,
    articleKey: 'aa'.repeat(32),
    articleRef: null,
    author: null,
    contentHash: null,
    arweaveId: null,
    splits: [],
    newAuthor: null,
    liveUntilLedger: null,
  })

  function fakeServer(
    send: Array<Partial<rpc.Api.SendTransactionResponse>>,
    opts: { simulateError?: string; poll?: string[] } = {}
  ) {
    const sent: string[] = []
    const polls = [...(opts.poll ?? [])]
    const server: RpcLike = {
      getAccount: async (id: string) => new Account(id, '10'),
      prepareTransaction: async (tx) => {
        if (opts.simulateError) throw new Error(opts.simulateError)
        return tx as Transaction
      },
      sendTransaction: async (tx) => {
        sent.push((tx as Transaction).toXDR())
        const next = send.shift() ?? { status: 'PENDING' }
        return { hash: '', ...next } as rpc.Api.SendTransactionResponse
      },
      getTransaction: async () =>
        ({
          status: polls.shift() ?? 'NOT_FOUND',
        }) as rpc.Api.GetTransactionResponse,
    }
    return { server, sent }
  }

  const sign = async (xdr: string) => {
    const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET) as Transaction
    tx.sign(signer)
    return tx.toXDR()
  }
  const noSleep = async () => {}

  it('builds with time bounds [0, maxTime] and reports the hash', async () => {
    const { server, sent } = fakeServer([{ status: 'PENDING' }])
    const out = await sendContractCall({ server, sign, sleep: noSleep }, call)
    expect(out.status).toBe('sent')
    const tx = TransactionBuilder.fromXDR(
      sent[0]!,
      Networks.TESTNET
    ) as Transaction
    expect(tx.timeBounds).toEqual({ minTime: '0', maxTime: '2000000000' })
    expect(tx.source).toBe(SIGNER)
    expect(out.status === 'sent' && out.hash).toBe(bytesToHex(tx.hash()))
  })

  it('stops at a simulation error and decodes the contract code', async () => {
    const { server, sent } = fakeServer([], {
      simulateError: 'HostError: Error(Contract, #19)',
    })
    const out = await sendContractCall({ server, sign }, call)
    expect(out).toMatchObject({
      status: 'simulation_failed',
      error: { code: 19, name: 'NoPendingAuthor' },
    })
    expect(sent).toHaveLength(0)
  })

  it('reports a wallet refusal without sending', async () => {
    const { server, sent } = fakeServer([])
    const out = await sendContractCall(
      {
        server,
        sign: async () => {
          throw new WalletError('rejected', 'User declined')
        },
      },
      call
    )
    expect(out).toMatchObject({ status: 'wallet_failed' })
    expect(out.status === 'wallet_failed' && out.error.kind).toBe('rejected')
    expect(sent).toHaveLength(0)
  })

  it('treats DUPLICATE as sent and resends TRY_AGAIN_LATER', async () => {
    const dup = fakeServer([{ status: 'DUPLICATE' }])
    expect(
      (await sendContractCall({ server: dup.server, sign }, call)).status
    ).toBe('sent')

    const retry = fakeServer([
      { status: 'TRY_AGAIN_LATER' },
      { status: 'TRY_AGAIN_LATER' },
      { status: 'PENDING' },
    ])
    const out = await sendContractCall(
      { server: retry.server, sign, sleep: noSleep },
      call
    )
    expect(out.status).toBe('sent')
    expect(retry.sent).toHaveLength(3)
    // The same envelope every time.
    expect(new Set(retry.sent).size).toBe(1)
  })

  it('gives up after the resend limit', async () => {
    const { server, sent } = fakeServer(
      Array.from({ length: 10 }, () => ({
        status: 'TRY_AGAIN_LATER' as const,
      }))
    )
    const out = await sendContractCall({ server, sign, sleep: noSleep }, call)
    expect(out.status).toBe('not_sent')
    expect(sent).toHaveLength(MAX_RESENDS + 1)
  })

  it('polls until a result or the deadline', async () => {
    const { server } = fakeServer([], { poll: ['NOT_FOUND', 'SUCCESS'] })
    expect(
      await pollTransaction({ server, sleep: noSleep }, 'ab', 2_000_000_000)
    ).toBe('SUCCESS')
    let clock = 0
    const slow = fakeServer([])
    expect(
      await pollTransaction(
        {
          server: slow.server,
          now: () => clock,
          sleep: async (ms) => {
            clock += ms
          },
        },
        'ab',
        10
      )
    ).toBe('TIMEOUT')
  })
})
