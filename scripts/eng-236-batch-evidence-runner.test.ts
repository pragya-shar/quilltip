import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ArticleBatchTipParams,
  HighlightBatchTipParams,
} from '../lib/stellar/types'

import {
  buildBatchEvidenceHelpText,
  buildBatchEvidenceTemplate,
  buildStellarExpertTransactionUrl,
  loadBatchEvidenceInput,
  parseCliArgs,
  runBatchEvidence,
  type BatchEvidenceRunnerDependencies,
} from './eng-236-batch-evidence-runner'

const CONTRACT_ID = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'
const TIPPER_PUBLIC_KEY =
  'GDKYMGH5YDTOVWBDQ2BH6IQCSVI33JHBWZ2GZQAV66JRJITTDAVBAHTN'
const AUTHOR_PUBLIC_KEY =
  'GAK6Z5YFAV5UQKW2UM7IKK65QJ3OQN6HTUWX3DZGHJ63T4CRXQK3Q6YB'
const SECOND_AUTHOR_PUBLIC_KEY =
  'GCBWQNDQ4K4N276QKCQKZVXXWMQZVGHKXJ2DT2VBBXPAF3LD7JFLJQHP'

const realEnv = process.env

afterEach(() => {
  process.env = realEnv
  vi.restoreAllMocks()
})

async function withTempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), 'eng-236-runner-test-'))
}

function makeInputFile(overrides: Record<string, unknown> = {}) {
  return JSON.stringify(
    {
      tipperPublicKey: TIPPER_PUBLIC_KEY,
      batches: [
        {
          id: 'article-smoke',
          tipType: 'article',
          tips: [
            {
              articleId: 'article-one',
              authorAddress: AUTHOR_PUBLIC_KEY,
              amountCents: 100,
            },
            {
              articleId: 'article-two',
              authorAddress: SECOND_AUTHOR_PUBLIC_KEY,
              amountCents: 250,
            },
          ],
        },
        {
          id: 'highlight-smoke',
          tipType: 'highlight',
          tips: [
            {
              highlightId: 'highlight-one',
              articleId: 'article-one',
              authorAddress: AUTHOR_PUBLIC_KEY,
              amountCents: 125,
            },
          ],
        },
      ],
      ...overrides,
    },
    null,
    2
  )
}

function makeDependencies(
  overrides: Partial<BatchEvidenceRunnerDependencies> = {}
): BatchEvidenceRunnerDependencies {
  return {
    buildArticleBatchTipTransaction: vi.fn(
      async (_tipper: string, tips: ArticleBatchTipParams[]) => ({
        xdr: 'article-prepared-xdr',
        stroops: 350_000_000,
        authorReceived: 341_250_000,
        platformFee: 8_750_000,
        items: tips.map((tip) => {
          const stroops = tip.amountCents === 100 ? 100_000_000 : 250_000_000
          return {
            ...tip,
            stroops,
            authorReceived: Math.floor(stroops * 0.975),
            platformFee: stroops - Math.floor(stroops * 0.975),
          }
        }),
      })
    ),
    buildHighlightBatchTipTransaction: vi.fn(
      async (_tipper: string, tips: HighlightBatchTipParams[]) => ({
        xdr: 'highlight-prepared-xdr',
        stroops: 125_000_000,
        authorReceived: 121_875_000,
        platformFee: 3_125_000,
        items: tips.map((tip) => ({
          ...tip,
          stroops: 125_000_000,
          authorReceived: 121_875_000,
          platformFee: 3_125_000,
        })),
      })
    ),
    signPreparedXdr: vi.fn(async (xdr) => `signed-${xdr}`),
    submitSignedBatchTransaction: vi.fn(async (signedXdr) => ({
      transactionHash: `${signedXdr}-hash`,
    })),
    now: () => new Date('2026-06-10T12:00:00.000Z'),
    ...overrides,
  }
}

describe('ENG-236 batch evidence runner', () => {
  it('builds a local template that covers article and highlight batch inputs', () => {
    const template = buildBatchEvidenceTemplate()

    expect(template.tipperPublicKey).toBe('<TESTNET tipper public key>')
    expect(template.batches).toHaveLength(2)
    expect(template.batches[0]).toMatchObject({
      id: 'article-batch-smoke',
      tipType: 'article',
      tips: [
        {
          articleId: '<article id>',
          authorAddress: '<author Stellar public key>',
          amountCents: 100,
        },
      ],
    })
    expect(template.batches[1]).toMatchObject({
      id: 'highlight-batch-smoke',
      tipType: 'highlight',
      tips: [
        {
          highlightId: '<highlight id>',
          articleId: '<article id>',
          authorAddress: '<author Stellar public key>',
          amountCents: 100,
        },
      ],
    })
  })

  it('loads and validates local batch evidence input', async () => {
    const dir = await withTempDir()
    const inputPath = path.join(dir, 'input.json')

    try {
      await writeFile(inputPath, makeInputFile(), 'utf8')

      const input = await loadBatchEvidenceInput(inputPath)

      expect(input.tipperPublicKey).toBe(TIPPER_PUBLIC_KEY)
      expect(input.batches).toHaveLength(2)
      expect(input.batches[0]?.tipType).toBe('article')
      expect(input.batches[1]?.tipType).toBe('highlight')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects malformed batch evidence input before network work', async () => {
    const dir = await withTempDir()
    const inputPath = path.join(dir, 'input.json')

    try {
      await writeFile(
        inputPath,
        makeInputFile({ tipperPublicKey: 'not-a-stellar-account' }),
        'utf8'
      )

      await expect(loadBatchEvidenceInput(inputPath)).rejects.toThrow(
        'tipperPublicKey must be a Stellar public key'
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('runs dry-run batches without requiring a secret or submitting', async () => {
    const dir = await withTempDir()
    const inputPath = path.join(dir, 'input.json')
    const outputPath = path.join(dir, 'evidence.local.jsonl')
    const deps = makeDependencies()

    try {
      await writeFile(inputPath, makeInputFile(), 'utf8')

      const result = await runBatchEvidence({
        inputPath,
        outputPath,
        dryRun: true,
        contractId: CONTRACT_ID,
        deps,
      })

      expect(result).toHaveLength(2)
      expect(deps.buildArticleBatchTipTransaction).toHaveBeenCalledWith(
        TIPPER_PUBLIC_KEY,
        [
          {
            articleId: 'article-one',
            authorAddress: AUTHOR_PUBLIC_KEY,
            amountCents: 100,
          },
          {
            articleId: 'article-two',
            authorAddress: SECOND_AUTHOR_PUBLIC_KEY,
            amountCents: 250,
          },
        ]
      )
      expect(deps.buildHighlightBatchTipTransaction).toHaveBeenCalledWith(
        TIPPER_PUBLIC_KEY,
        [
          {
            highlightId: 'highlight-one',
            articleId: 'article-one',
            authorAddress: AUTHOR_PUBLIC_KEY,
            amountCents: 125,
          },
        ]
      )
      expect(deps.signPreparedXdr).not.toHaveBeenCalled()
      expect(deps.submitSignedBatchTransaction).not.toHaveBeenCalled()

      const lines = (await readFile(outputPath, 'utf8')).trim().split('\n')
      expect(lines).toHaveLength(2)
      expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
        issue: 'ENG-236',
        dryRun: true,
        batchId: 'article-smoke',
        tipType: 'article',
        batchSize: 2,
        contractId: CONTRACT_ID,
        tipperPublicKey: TIPPER_PUBLIC_KEY,
        transactionHash: null,
        stellarExpertUrl: null,
      })
      expect(JSON.parse(lines[1] ?? '{}')).toMatchObject({
        issue: 'ENG-236',
        dryRun: true,
        batchId: 'highlight-smoke',
        tipType: 'highlight',
        batchSize: 1,
        contractId: CONTRACT_ID,
        tipperPublicKey: TIPPER_PUBLIC_KEY,
        transactionHash: null,
        stellarExpertUrl: null,
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('records item-level evidence for ENG-236 storage spot checks', async () => {
    const dir = await withTempDir()
    const inputPath = path.join(dir, 'input.json')
    const outputPath = path.join(dir, 'evidence.local.jsonl')
    const deps = makeDependencies()

    try {
      await writeFile(inputPath, makeInputFile(), 'utf8')

      const result = await runBatchEvidence({
        inputPath,
        outputPath,
        dryRun: true,
        contractId: CONTRACT_ID,
        deps,
      })

      expect(result[0]).toMatchObject({
        issue: 'ENG-236',
        batchId: 'article-smoke',
        tipType: 'article',
        batchSize: 2,
        items: [
          {
            articleId: 'article-one',
            authorAddress: AUTHOR_PUBLIC_KEY,
            amountCents: 100,
            stroops: 100_000_000,
            authorReceived: 97_500_000,
            platformFee: 2_500_000,
          },
          {
            articleId: 'article-two',
            authorAddress: SECOND_AUTHOR_PUBLIC_KEY,
            amountCents: 250,
            stroops: 250_000_000,
            authorReceived: 243_750_000,
            platformFee: 6_250_000,
          },
        ],
      })
      expect(result[1]).toMatchObject({
        issue: 'ENG-236',
        batchId: 'highlight-smoke',
        tipType: 'highlight',
        batchSize: 1,
        items: [
          {
            highlightId: 'highlight-one',
            articleId: 'article-one',
            authorAddress: AUTHOR_PUBLIC_KEY,
            amountCents: 125,
            stroops: 125_000_000,
            authorReceived: 121_875_000,
            platformFee: 3_125_000,
          },
        ],
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('uses ENG-236 local input and evidence paths by default', () => {
    expect(parseCliArgs(['--write-template'])).toMatchObject({
      writeTemplate: true,
      templatePath: 'scripts/eng-236-batch-input.local.json',
      outputPath: 'docs/eng-236-batch-evidence.local.jsonl',
    })
  })

  it('shows issue-specific operator commands in help text', () => {
    const helpText = buildBatchEvidenceHelpText()

    expect(helpText).toContain('ENG-236 local batch evidence runner')
    expect(helpText).toContain(
      'bun run eng-236:batch-evidence -- --write-template'
    )
    expect(helpText).toContain('scripts/eng-236-batch-input.local.json')
  })

  it('signs and submits each batch when dry-run is disabled', async () => {
    const dir = await withTempDir()
    const inputPath = path.join(dir, 'input.json')
    const outputPath = path.join(dir, 'evidence.local.jsonl')
    const deps = makeDependencies()

    try {
      await writeFile(inputPath, makeInputFile(), 'utf8')

      await runBatchEvidence({
        inputPath,
        outputPath,
        dryRun: false,
        contractId: CONTRACT_ID,
        secretKey: 'S'.repeat(56),
        deps,
      })

      expect(deps.signPreparedXdr).toHaveBeenCalledTimes(2)
      expect(deps.submitSignedBatchTransaction).toHaveBeenCalledTimes(2)

      const lines = (await readFile(outputPath, 'utf8')).trim().split('\n')
      expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
        dryRun: false,
        transactionHash: 'signed-article-prepared-xdr-hash',
        stellarExpertUrl:
          'https://stellar.expert/explorer/testnet/tx/signed-article-prepared-xdr-hash',
      })
      expect(JSON.parse(lines[1] ?? '{}')).toMatchObject({
        dryRun: false,
        transactionHash: 'signed-highlight-prepared-xdr-hash',
        stellarExpertUrl:
          'https://stellar.expert/explorer/testnet/tx/signed-highlight-prepared-xdr-hash',
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('requires an operator secret for live submission', async () => {
    const dir = await withTempDir()
    const inputPath = path.join(dir, 'input.json')
    const outputPath = path.join(dir, 'evidence.local.jsonl')

    try {
      await writeFile(inputPath, makeInputFile(), 'utf8')

      await expect(
        runBatchEvidence({
          inputPath,
          outputPath,
          dryRun: false,
          contractId: CONTRACT_ID,
          deps: makeDependencies(),
        })
      ).rejects.toThrow('ENG236_TIPPER_SECRET_KEY is required')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('Stellar Expert evidence links', () => {
  it('uses the testnet explorer for TESTNET evidence', () => {
    expect(buildStellarExpertTransactionUrl('abc123', 'TESTNET')).toBe(
      'https://stellar.expert/explorer/testnet/tx/abc123'
    )
  })

  it('uses the public explorer for MAINNET evidence', () => {
    expect(buildStellarExpertTransactionUrl('abc123', 'MAINNET')).toBe(
      'https://stellar.expert/explorer/public/tx/abc123'
    )
  })
})
