/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest'
import { verifyTipTransaction } from './horizon'
import {
  Account,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  nativeToScVal,
} from '@stellar/stellar-sdk'

const HORIZON = 'https://horizon-testnet.stellar.org'
const TX = 'abc123'
const SOURCE_KEYPAIR = Keypair.random()
const AUTHOR_ONE_KEYPAIR = Keypair.random()
const AUTHOR_TWO_KEYPAIR = Keypair.random()
const ATTACKER_KEYPAIR = Keypair.random()
const SOURCE = SOURCE_KEYPAIR.publicKey()
const AUTHOR_ONE = AUTHOR_ONE_KEYPAIR.publicKey()
const AUTHOR_TWO = AUTHOR_TWO_KEYPAIR.publicKey()
const ATTACKER = ATTACKER_KEYPAIR.publicKey()
const CONTRACT_ID = 'CC7Q3HDXQHMSI2WUE6C2KC35TRLPL22T3WEGZ67AB7KK5PDDJHQPZMZY'
const WRONG_CONTRACT_ID =
  'CAS44OQK7A6W5FDRAH3K3ZN7TTQTJ5ESRVG6MB2HBVFWZ5TVH26UUB4S'

function makeFetch(
  response:
    | { status: number; ok?: boolean; body?: unknown; jsonThrows?: boolean }
    | { throws: true }
) {
  return async (url: string) => {
    if ('throws' in response) {
      throw new Error('network down')
    }
    expect(url.startsWith(HORIZON)).toBe(true)
    expect(url.includes(TX)).toBe(true)
    return {
      status: response.status,
      ok: response.ok ?? (response.status >= 200 && response.status < 300),
      json: async () => {
        if (response.jsonThrows) throw new Error('bad json')
        return response.body
      },
    }
  }
}

function horizonBody(envelopeXdr: string) {
  return {
    successful: true,
    source_account: SOURCE,
    ledger: 12345,
    envelope_xdr: envelopeXdr,
  }
}

function buildArticleEnvelope(opts: {
  articleId: string
  amount: bigint
  author?: string
  timeBounds?: { minTime: string; maxTime: string }
}) {
  const account = new Account(SOURCE, '1')
  const contract = new Contract(CONTRACT_ID)
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
    timebounds: opts.timeBounds ?? {
      minTime: '1',
      maxTime: '2000000000',
    },
  })
    .addOperation(
      contract.call(
        'tip_article',
        nativeToScVal(SOURCE, { type: 'address' }),
        nativeToScVal(opts.articleId, { type: 'symbol' }),
        nativeToScVal(opts.author ?? AUTHOR_ONE, { type: 'address' }),
        nativeToScVal(opts.amount, { type: 'i128' })
      )
    )
    .build()

  return tx.toEnvelope().toXDR('base64')
}

function buildHighlightEnvelope(opts: {
  highlightId: string
  articleId: string
  amount: bigint
}) {
  const account = new Account(SOURCE, '1')
  const contract = new Contract(CONTRACT_ID)
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      contract.call(
        'tip_highlight_direct',
        nativeToScVal(SOURCE, { type: 'address' }),
        nativeToScVal(opts.highlightId, { type: 'string' }),
        nativeToScVal(opts.articleId, { type: 'symbol' }),
        nativeToScVal(AUTHOR_ONE, { type: 'address' }),
        nativeToScVal(opts.amount, { type: 'i128' })
      )
    )
    .setTimeout(30)
    .build()

  return tx.toEnvelope().toXDR('base64')
}

function buildArticleBatchEnvelope(opts: {
  contractId?: string
  tips: Array<{ articleId: string; author: string; amount: bigint }>
}) {
  const account = new Account(SOURCE, '1')
  const contract = new Contract(opts.contractId ?? CONTRACT_ID)
  const tips = opts.tips.map((tip) => ({
    article_id: tip.articleId,
    author: tip.author,
    amount: tip.amount,
  }))

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      contract.call(
        'batch_tip',
        nativeToScVal(SOURCE, { type: 'address' }),
        nativeToScVal(tips, {
          type: {
            article_id: ['symbol', 'symbol'],
            author: ['symbol', 'address'],
            amount: ['symbol', 'i128'],
          },
        })
      )
    )
    .setTimeout(30)
    .build()

  return tx.toEnvelope().toXDR('base64')
}

function buildHighlightBatchEnvelope(opts: {
  tips: Array<{
    highlightId: string
    articleId: string
    author: string
    amount: bigint
  }>
}) {
  const account = new Account(SOURCE, '1')
  const contract = new Contract(CONTRACT_ID)
  const tips = opts.tips.map((tip) => ({
    highlight_id: tip.highlightId,
    article_id: tip.articleId,
    author: tip.author,
    amount: tip.amount,
  }))

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      contract.call(
        'batch_tip_highlights',
        nativeToScVal(SOURCE, { type: 'address' }),
        nativeToScVal(tips, {
          type: {
            highlight_id: ['symbol', 'string'],
            article_id: ['symbol', 'symbol'],
            author: ['symbol', 'address'],
            amount: ['symbol', 'i128'],
          },
        })
      )
    )
    .setTimeout(30)
    .build()

  return tx.toEnvelope().toXDR('base64')
}

describe('verifyTipTransaction', () => {
  it('rejects a copied Soroban transaction bound to another intent time window', async () => {
    const envelopeXdr = buildArticleEnvelope({
      articleId: 'article123',
      amount: BigInt(10_000_000),
      timeBounds: {
        minTime: '123456789',
        maxTime: '2000000000',
      },
    })
    const invocation = {
      contractId: CONTRACT_ID,
      allowedFunctions: ['tip_article'],
      authorAddress: AUTHOR_ONE,
      articleId: 'article123',
      minStroops: BigInt(10_000_000),
      exactStroops: BigInt(10_000_000),
      expectedTimeBounds: {
        minTime: '987654321',
        maxTime: '2000000001',
      },
    }

    const result = await verifyTipTransaction(
      makeFetch({ status: 200, body: horizonBody(envelopeXdr) }),
      {
        txId: TX,
        expectedSource: SOURCE,
        horizonUrl: HORIZON,
        invocation,
      }
    )

    expect(result).toEqual({
      ok: false,
      kind: 'permanent',
      reason: 'timebounds_mismatch',
    })
  })

  it('returns ok=true when the tx is successful and source matches', async () => {
    const fetchImpl = makeFetch({
      status: 200,
      body: { successful: true, source_account: SOURCE, ledger: 12345 },
    })

    const result = await verifyTipTransaction(fetchImpl, {
      txId: TX,
      expectedSource: SOURCE,
      horizonUrl: HORIZON,
    })
    expect(result).toEqual({ ok: true, ledger: 12345, onChainStroops: null })
  })

  it('rejects a transaction created after the prepared intent window', async () => {
    const fetchImpl = makeFetch({
      status: 200,
      body: {
        successful: true,
        source_account: SOURCE,
        ledger: 12345,
        created_at: new Date(2_000).toISOString(),
      },
    })

    const result = await verifyTipTransaction(fetchImpl, {
      txId: TX,
      expectedSource: SOURCE,
      horizonUrl: HORIZON,
      minCreatedAtMs: 0,
      maxCreatedAtMs: 1_000,
    })

    expect(result).toEqual({
      ok: false,
      kind: 'permanent',
      reason: 'transaction_after_intent',
    })
  })

  it.each([
    { label: 'missing', createdAt: undefined },
    { label: 'malformed', createdAt: 'not-a-ledger-timestamp' },
  ])(
    'rejects a $label Horizon timestamp when an intent window is required',
    async ({ createdAt }) => {
      const fetchImpl = makeFetch({
        status: 200,
        body: {
          successful: true,
          source_account: SOURCE,
          ledger: 12345,
          ...(createdAt === undefined ? {} : { created_at: createdAt }),
        },
      })

      const result = await verifyTipTransaction(fetchImpl, {
        txId: TX,
        expectedSource: SOURCE,
        horizonUrl: HORIZON,
        minCreatedAtMs: 0,
        maxCreatedAtMs: 1_000,
      })

      expect(result).toEqual({
        ok: false,
        kind: 'permanent',
        reason: 'malformed_response',
      })
    }
  )

  it('returns transient not_found on 404 (Horizon propagation lag)', async () => {
    const fetchImpl = makeFetch({ status: 404 })
    const result = await verifyTipTransaction(fetchImpl, {
      txId: TX,
      expectedSource: SOURCE,
      horizonUrl: HORIZON,
    })
    expect(result).toEqual({
      ok: false,
      kind: 'transient',
      reason: 'not_found',
    })
  })

  it('returns transient server_error on 5xx', async () => {
    const fetchImpl = makeFetch({ status: 503 })
    const result = await verifyTipTransaction(fetchImpl, {
      txId: TX,
      expectedSource: SOURCE,
      horizonUrl: HORIZON,
    })
    expect(result).toEqual({
      ok: false,
      kind: 'transient',
      reason: 'server_error',
    })
  })

  it.each([408, 429])(
    'returns transient server_error on retryable HTTP %i',
    async (status) => {
      const fetchImpl = makeFetch({ status })
      const result = await verifyTipTransaction(fetchImpl, {
        txId: TX,
        expectedSource: SOURCE,
        horizonUrl: HORIZON,
      })
      expect(result).toEqual({
        ok: false,
        kind: 'transient',
        reason: 'server_error',
      })
    }
  )

  it('returns transient network_error when fetch throws', async () => {
    const fetchImpl = makeFetch({ throws: true })
    const result = await verifyTipTransaction(fetchImpl, {
      txId: TX,
      expectedSource: SOURCE,
      horizonUrl: HORIZON,
    })
    expect(result).toEqual({
      ok: false,
      kind: 'transient',
      reason: 'network_error',
    })
  })

  it('returns transient server_error before parsing an expected batch invocation', async () => {
    const fetchImpl = makeFetch({ status: 503 })
    const result = await verifyTipTransaction(fetchImpl, {
      txId: TX,
      expectedSource: SOURCE,
      horizonUrl: HORIZON,
      invocation: {
        contractId: CONTRACT_ID,
        allowedFunctions: ['batch_tip'],
        authorAddress: AUTHOR_ONE,
        minStroops: BigInt(100_000_000),
        batchTips: [
          { authorAddress: AUTHOR_ONE, minStroops: BigInt(100_000_000) },
        ],
      },
    })
    expect(result).toEqual({
      ok: false,
      kind: 'transient',
      reason: 'server_error',
    })
  })

  it('returns permanent unsuccessful when successful=false', async () => {
    const fetchImpl = makeFetch({
      status: 200,
      body: { successful: false, source_account: SOURCE, ledger: 12345 },
    })
    const result = await verifyTipTransaction(fetchImpl, {
      txId: TX,
      expectedSource: SOURCE,
      horizonUrl: HORIZON,
    })
    expect(result).toEqual({
      ok: false,
      kind: 'permanent',
      reason: 'unsuccessful',
    })
  })

  it('returns permanent source_mismatch when source_account differs', async () => {
    const fetchImpl = makeFetch({
      status: 200,
      body: {
        successful: true,
        source_account: 'GDIFFERENT',
        ledger: 12345,
      },
    })
    const result = await verifyTipTransaction(fetchImpl, {
      txId: TX,
      expectedSource: SOURCE,
      horizonUrl: HORIZON,
    })
    expect(result).toEqual({
      ok: false,
      kind: 'permanent',
      reason: 'source_mismatch',
    })
  })

  it('returns permanent not_in_ledger when ledger is missing', async () => {
    const fetchImpl = makeFetch({
      status: 200,
      body: { successful: true, source_account: SOURCE },
    })
    const result = await verifyTipTransaction(fetchImpl, {
      txId: TX,
      expectedSource: SOURCE,
      horizonUrl: HORIZON,
    })
    expect(result).toEqual({
      ok: false,
      kind: 'permanent',
      reason: 'not_in_ledger',
    })
  })

  it('returns permanent malformed_response on unexpected shape', async () => {
    const fetchImpl = makeFetch({
      status: 200,
      body: { unexpected: 'shape' },
    })
    const result = await verifyTipTransaction(fetchImpl, {
      txId: TX,
      expectedSource: SOURCE,
      horizonUrl: HORIZON,
    })
    expect(result).toEqual({
      ok: false,
      kind: 'permanent',
      reason: 'malformed_response',
    })
  })

  it('returns permanent malformed_response when json parsing throws', async () => {
    const fetchImpl = makeFetch({ status: 200, jsonThrows: true })
    const result = await verifyTipTransaction(fetchImpl, {
      txId: TX,
      expectedSource: SOURCE,
      horizonUrl: HORIZON,
    })
    expect(result).toEqual({
      ok: false,
      kind: 'permanent',
      reason: 'malformed_response',
    })
  })

  it('strips a trailing slash from horizonUrl', async () => {
    let capturedUrl = ''
    const fetchImpl = async (url: string) => {
      capturedUrl = url
      return {
        status: 200,
        ok: true,
        json: async () => ({
          successful: true,
          source_account: SOURCE,
          ledger: 1,
        }),
      }
    }
    await verifyTipTransaction(fetchImpl, {
      txId: TX,
      expectedSource: SOURCE,
      horizonUrl: `${HORIZON}/`,
    })
    expect(capturedUrl).toBe(`${HORIZON}/transactions/${TX}`)
  })

  it('rejects a single article tip for a different article symbol', async () => {
    const envelopeXdr = buildArticleEnvelope({
      articleId: 'wrong12345',
      amount: BigInt(20_000_000),
    })
    const fetchImpl = makeFetch({ status: 200, body: horizonBody(envelopeXdr) })

    const result = await verifyTipTransaction(fetchImpl, {
      txId: TX,
      expectedSource: SOURCE,
      horizonUrl: HORIZON,
      invocation: {
        contractId: CONTRACT_ID,
        allowedFunctions: ['tip_article'],
        authorAddress: AUTHOR_ONE,
        minStroops: BigInt(20_000_000),
        articleId: 'right12345',
      },
    })

    expect(result).toEqual({
      ok: false,
      kind: 'permanent',
      reason: 'article_mismatch',
    })
  })

  it('rejects a single article tip whose amount differs from the prepared amount', async () => {
    const envelopeXdr = buildArticleEnvelope({
      articleId: 'right12345',
      amount: BigInt(20_000_001),
    })
    const fetchImpl = makeFetch({ status: 200, body: horizonBody(envelopeXdr) })

    const result = await verifyTipTransaction(fetchImpl, {
      txId: TX,
      expectedSource: SOURCE,
      horizonUrl: HORIZON,
      invocation: {
        contractId: CONTRACT_ID,
        allowedFunctions: ['tip_article'],
        authorAddress: AUTHOR_ONE,
        minStroops: BigInt(20_000_000),
        exactStroops: BigInt(20_000_000),
        articleId: 'right12345',
      },
    })

    expect(result).toEqual({
      ok: false,
      kind: 'permanent',
      reason: 'amount_mismatch',
    })
  })

  it('rejects a single highlight tip for a different exact highlight id', async () => {
    const envelopeXdr = buildHighlightEnvelope({
      highlightId: 'wrong-highlight',
      articleId: 'article-one',
      amount: BigInt(20_000_000),
    })
    const fetchImpl = makeFetch({ status: 200, body: horizonBody(envelopeXdr) })

    const result = await verifyTipTransaction(fetchImpl, {
      txId: TX,
      expectedSource: SOURCE,
      horizonUrl: HORIZON,
      invocation: {
        contractId: CONTRACT_ID,
        allowedFunctions: ['tip_highlight_direct'],
        authorAddress: AUTHOR_ONE,
        highlightId: 'right-highlight',
        articleId: 'article-one',
        minStroops: BigInt(20_000_000),
        exactStroops: BigInt(20_000_000),
      },
    })

    expect(result).toEqual({
      ok: false,
      kind: 'permanent',
      reason: 'highlight_mismatch',
    })
  })

  it('accepts batch_tip when every article tip matches expected batch items', async () => {
    const envelopeXdr = buildArticleBatchEnvelope({
      tips: [
        {
          articleId: 'article-one',
          author: AUTHOR_ONE,
          amount: BigInt(100_000_000),
        },
        {
          articleId: 'article-two',
          author: AUTHOR_TWO,
          amount: BigInt(250_000_000),
        },
      ],
    })
    const fetchImpl = makeFetch({ status: 200, body: horizonBody(envelopeXdr) })

    const result = await verifyTipTransaction(fetchImpl, {
      txId: TX,
      expectedSource: SOURCE,
      horizonUrl: HORIZON,
      invocation: {
        contractId: CONTRACT_ID,
        allowedFunctions: ['batch_tip'],
        authorAddress: AUTHOR_ONE,
        minStroops: BigInt(100_000_000),
        batchTips: [
          { authorAddress: AUTHOR_ONE, minStroops: BigInt(100_000_000) },
          { authorAddress: AUTHOR_TWO, minStroops: BigInt(200_000_000) },
        ],
      },
    })

    expect(result).toEqual({
      ok: true,
      ledger: 12345,
      onChainStroops: BigInt(350_000_000),
    })
  })

  it('accepts batch_tip_highlights when every highlight tip matches expected batch items', async () => {
    const envelopeXdr = buildHighlightBatchEnvelope({
      tips: [
        {
          highlightId: 'highlight-1',
          articleId: 'article-one',
          author: AUTHOR_ONE,
          amount: BigInt(125_000_000),
        },
        {
          highlightId: 'highlight-2',
          articleId: 'article-two',
          author: AUTHOR_TWO,
          amount: BigInt(175_000_000),
        },
      ],
    })
    const fetchImpl = makeFetch({ status: 200, body: horizonBody(envelopeXdr) })

    const result = await verifyTipTransaction(fetchImpl, {
      txId: TX,
      expectedSource: SOURCE,
      horizonUrl: HORIZON,
      invocation: {
        contractId: CONTRACT_ID,
        allowedFunctions: ['batch_tip_highlights'],
        authorAddress: AUTHOR_ONE,
        minStroops: BigInt(100_000_000),
        batchTips: [
          {
            highlightId: 'highlight-1',
            articleId: 'article-one',
            authorAddress: AUTHOR_ONE,
            minStroops: BigInt(100_000_000),
            exactStroops: BigInt(125_000_000),
          },
          {
            highlightId: 'highlight-2',
            articleId: 'article-two',
            authorAddress: AUTHOR_TWO,
            minStroops: BigInt(150_000_000),
            exactStroops: BigInt(175_000_000),
          },
        ],
      },
    })

    expect(result).toEqual({
      ok: true,
      ledger: 12345,
      onChainStroops: BigInt(300_000_000),
    })
  })

  it('rejects batch_tip when the contract is wrong', async () => {
    const envelopeXdr = buildArticleBatchEnvelope({
      contractId: WRONG_CONTRACT_ID,
      tips: [
        {
          articleId: 'article-one',
          author: AUTHOR_ONE,
          amount: BigInt(100_000_000),
        },
      ],
    })
    const fetchImpl = makeFetch({ status: 200, body: horizonBody(envelopeXdr) })

    const result = await verifyTipTransaction(fetchImpl, {
      txId: TX,
      expectedSource: SOURCE,
      horizonUrl: HORIZON,
      invocation: {
        contractId: CONTRACT_ID,
        allowedFunctions: ['batch_tip'],
        authorAddress: AUTHOR_ONE,
        minStroops: BigInt(100_000_000),
        batchTips: [
          { authorAddress: AUTHOR_ONE, minStroops: BigInt(100_000_000) },
        ],
      },
    })

    expect(result).toEqual({
      ok: false,
      kind: 'permanent',
      reason: 'contract_mismatch',
    })
  })

  it('rejects batch_tip when any article tip author is wrong', async () => {
    const envelopeXdr = buildArticleBatchEnvelope({
      tips: [
        {
          articleId: 'article-one',
          author: AUTHOR_ONE,
          amount: BigInt(100_000_000),
        },
        {
          articleId: 'article-two',
          author: ATTACKER,
          amount: BigInt(250_000_000),
        },
      ],
    })
    const fetchImpl = makeFetch({ status: 200, body: horizonBody(envelopeXdr) })

    const result = await verifyTipTransaction(fetchImpl, {
      txId: TX,
      expectedSource: SOURCE,
      horizonUrl: HORIZON,
      invocation: {
        contractId: CONTRACT_ID,
        allowedFunctions: ['batch_tip'],
        authorAddress: AUTHOR_ONE,
        minStroops: BigInt(100_000_000),
        batchTips: [
          { authorAddress: AUTHOR_ONE, minStroops: BigInt(100_000_000) },
          { authorAddress: AUTHOR_TWO, minStroops: BigInt(200_000_000) },
        ],
      },
    })

    expect(result).toEqual({
      ok: false,
      kind: 'permanent',
      reason: 'author_mismatch',
    })
  })

  it('rejects batch_tip when any article tip amount is too small', async () => {
    const envelopeXdr = buildArticleBatchEnvelope({
      tips: [
        {
          articleId: 'article-one',
          author: AUTHOR_ONE,
          amount: BigInt(100_000_000),
        },
        {
          articleId: 'article-two',
          author: AUTHOR_TWO,
          amount: BigInt(50_000_000),
        },
      ],
    })
    const fetchImpl = makeFetch({ status: 200, body: horizonBody(envelopeXdr) })

    const result = await verifyTipTransaction(fetchImpl, {
      txId: TX,
      expectedSource: SOURCE,
      horizonUrl: HORIZON,
      invocation: {
        contractId: CONTRACT_ID,
        allowedFunctions: ['batch_tip'],
        authorAddress: AUTHOR_ONE,
        minStroops: BigInt(100_000_000),
        batchTips: [
          { authorAddress: AUTHOR_ONE, minStroops: BigInt(100_000_000) },
          { authorAddress: AUTHOR_TWO, minStroops: BigInt(200_000_000) },
        ],
      },
    })

    expect(result).toEqual({
      ok: false,
      kind: 'permanent',
      reason: 'amount_mismatch',
    })
  })

  it('rejects batch_tip_highlights when any highlight tip amount is too small', async () => {
    const envelopeXdr = buildHighlightBatchEnvelope({
      tips: [
        {
          highlightId: 'highlight-1',
          articleId: 'article-one',
          author: AUTHOR_ONE,
          amount: BigInt(125_000_000),
        },
        {
          highlightId: 'highlight-2',
          articleId: 'article-two',
          author: AUTHOR_TWO,
          amount: BigInt(50_000_000),
        },
      ],
    })
    const fetchImpl = makeFetch({ status: 200, body: horizonBody(envelopeXdr) })

    const result = await verifyTipTransaction(fetchImpl, {
      txId: TX,
      expectedSource: SOURCE,
      horizonUrl: HORIZON,
      invocation: {
        contractId: CONTRACT_ID,
        allowedFunctions: ['batch_tip_highlights'],
        authorAddress: AUTHOR_ONE,
        minStroops: BigInt(100_000_000),
        batchTips: [
          { authorAddress: AUTHOR_ONE, minStroops: BigInt(100_000_000) },
          { authorAddress: AUTHOR_TWO, minStroops: BigInt(150_000_000) },
        ],
      },
    })

    expect(result).toEqual({
      ok: false,
      kind: 'permanent',
      reason: 'amount_mismatch',
    })
  })

  it('rejects batch_tip_highlights when an exact highlight id differs', async () => {
    const envelopeXdr = buildHighlightBatchEnvelope({
      tips: [
        {
          highlightId: 'wrong-highlight',
          articleId: 'article-one',
          author: AUTHOR_ONE,
          amount: BigInt(125_000_000),
        },
      ],
    })
    const fetchImpl = makeFetch({ status: 200, body: horizonBody(envelopeXdr) })

    const result = await verifyTipTransaction(fetchImpl, {
      txId: TX,
      expectedSource: SOURCE,
      horizonUrl: HORIZON,
      invocation: {
        contractId: CONTRACT_ID,
        allowedFunctions: ['batch_tip_highlights'],
        authorAddress: AUTHOR_ONE,
        minStroops: BigInt(125_000_000),
        batchTips: [
          {
            highlightId: 'right-highlight',
            articleId: 'article-one',
            authorAddress: AUTHOR_ONE,
            minStroops: BigInt(125_000_000),
            exactStroops: BigInt(125_000_000),
          },
        ],
      },
    })

    expect(result).toEqual({
      ok: false,
      kind: 'permanent',
      reason: 'highlight_mismatch',
    })
  })
})
