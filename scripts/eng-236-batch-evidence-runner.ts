import { appendFile, mkdir, readFile, writeFile } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { z } from 'zod'

import { StellarClient } from '../lib/stellar/client'
import { STELLAR_CONFIG } from '../lib/stellar/config'
import { loadStellarSdk } from '../lib/stellar/sdk-loader'
import type {
  ArticleBatchTipParams,
  ArticleBatchTipQuote,
  BatchTipTransactionResult,
  HighlightBatchTipParams,
  HighlightBatchTipQuote,
} from '../lib/stellar/types'

const ISSUE_ID = 'ENG-236'
const DEFAULT_TEMPLATE_PATH = 'scripts/eng-236-batch-input.local.json'
const DEFAULT_EVIDENCE_PATH = 'docs/eng-236-batch-evidence.local.jsonl'
const SUBMISSION_MAX_ATTEMPTS = 30
const SUBMISSION_RETRY_DELAY_MS = 1_000

const stellarAccountSchema = z
  .string()
  .regex(/^G[A-Z2-7]{55}$/, 'must be a Stellar public key')

const articleTipSchema = z.object({
  articleId: z.string().min(1, 'articleId is required'),
  authorAddress: stellarAccountSchema,
  amountCents: z.number().int().positive('amountCents must be positive'),
})

const highlightTipSchema = articleTipSchema.extend({
  highlightId: z.string().min(1, 'highlightId is required'),
})

const articleBatchSchema = z.object({
  id: z.string().min(1).optional(),
  tipType: z.literal('article'),
  tips: z
    .array(articleTipSchema)
    .min(1, 'article batch needs at least one tip'),
})

const highlightBatchSchema = z.object({
  id: z.string().min(1).optional(),
  tipType: z.literal('highlight'),
  tips: z
    .array(highlightTipSchema)
    .min(1, 'highlight batch needs at least one tip'),
})

const batchEvidenceInputSchema = z.object({
  tipperPublicKey: stellarAccountSchema,
  batches: z
    .array(
      z.discriminatedUnion('tipType', [
        articleBatchSchema,
        highlightBatchSchema,
      ])
    )
    .min(1, 'at least one batch is required'),
})

export type BatchEvidenceInput = z.infer<typeof batchEvidenceInputSchema>
export type BatchEvidenceBatch = BatchEvidenceInput['batches'][number]
export type BatchEvidenceItem = ArticleBatchTipQuote | HighlightBatchTipQuote

export type BatchEvidenceLine = {
  issue: typeof ISSUE_ID
  recordedAt: string
  network: string
  dryRun: boolean
  batchId: string
  tipType: BatchEvidenceBatch['tipType']
  batchSize: number
  contractId: string
  tipperPublicKey: string
  transactionHash: string | null
  stellarExpertUrl: string | null
  stroops: number
  authorReceived: number
  platformFee: number
  items: BatchEvidenceItem[]
}

export type BatchSubmitResult = {
  transactionHash: string
}

export type BatchEvidenceRunnerDependencies = {
  buildArticleBatchTipTransaction: (
    tipperPublicKey: string,
    tips: ArticleBatchTipParams[]
  ) => Promise<BatchTipTransactionResult<ArticleBatchTipQuote>>
  buildHighlightBatchTipTransaction: (
    tipperPublicKey: string,
    tips: HighlightBatchTipParams[]
  ) => Promise<BatchTipTransactionResult<HighlightBatchTipQuote>>
  signPreparedXdr: (
    xdr: string,
    secretKey: string,
    expectedPublicKey: string
  ) => Promise<string>
  submitSignedBatchTransaction: (
    signedXdr: string
  ) => Promise<BatchSubmitResult>
  now: () => Date
}

export type RunBatchEvidenceOptions = {
  inputPath: string
  outputPath?: string
  dryRun: boolean
  contractId?: string
  secretKey?: string
  deps?: BatchEvidenceRunnerDependencies
}

type CliOptions = {
  inputPath?: string
  outputPath: string
  dryRun: boolean
  writeTemplate: boolean
  templatePath: string
  help: boolean
}

export function buildBatchEvidenceTemplate(): BatchEvidenceInput {
  return {
    tipperPublicKey: '<TESTNET tipper public key>',
    batches: [
      {
        id: 'article-batch-smoke',
        tipType: 'article',
        tips: [
          {
            articleId: '<article id>',
            authorAddress: '<author Stellar public key>',
            amountCents: 100,
          },
        ],
      },
      {
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
      },
    ],
  }
}

export async function writeBatchEvidenceTemplate(
  templatePath = DEFAULT_TEMPLATE_PATH
): Promise<void> {
  await mkdir(path.dirname(templatePath), { recursive: true })
  await writeFile(
    templatePath,
    `${JSON.stringify(buildBatchEvidenceTemplate(), null, 2)}\n`,
    'utf8'
  )
}

export async function loadBatchEvidenceInput(
  inputPath: string
): Promise<BatchEvidenceInput> {
  let raw: string
  try {
    raw = await readFile(inputPath, 'utf8')
  } catch (error) {
    throw new Error(
      `Could not read batch evidence input at ${inputPath}: ${formatError(error)}`
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(
      `Batch evidence input must be valid JSON: ${formatError(error)}`
    )
  }

  const result = batchEvidenceInputSchema.safeParse(parsed)
  if (!result.success) {
    const issue = result.error.issues[0]
    const location = issue?.path.join('.') || 'input'
    const message = issue?.message || 'invalid input'
    throw new Error(`${location} ${message}`)
  }

  return result.data
}

export function buildStellarExpertTransactionUrl(
  transactionHash: string,
  network: string
): string {
  const explorerNetwork = network === 'MAINNET' ? 'public' : 'testnet'
  return `https://stellar.expert/explorer/${explorerNetwork}/tx/${transactionHash}`
}

export async function signPreparedXdr(
  xdr: string,
  secretKey: string,
  expectedPublicKey: string
): Promise<string> {
  const StellarSdk = await loadStellarSdk()
  const keypair = StellarSdk.Keypair.fromSecret(secretKey)

  if (keypair.publicKey() !== expectedPublicKey) {
    throw new Error(
      'ENG236_TIPPER_SECRET_KEY does not match input tipperPublicKey'
    )
  }

  const transaction = StellarSdk.TransactionBuilder.fromXDR(
    xdr,
    STELLAR_CONFIG.NETWORK_PASSPHRASE
  )
  transaction.sign(keypair)

  return transaction.toXDR()
}

export async function submitSignedBatchTransaction(
  signedXdr: string
): Promise<BatchSubmitResult> {
  const StellarSdk = await loadStellarSdk()
  const sorobanServer = new StellarSdk.rpc.Server(
    STELLAR_CONFIG.SOROBAN_RPC_URL
  )
  const transaction = StellarSdk.TransactionBuilder.fromXDR(
    signedXdr,
    STELLAR_CONFIG.NETWORK_PASSPHRASE
  )

  const submission = await sorobanServer.sendTransaction(transaction)
  if (submission.status !== 'PENDING') {
    throw new Error(
      `Batch transaction submission failed with status ${submission.status}: ${formatRpcError(submission.errorResult)}`
    )
  }

  for (let attempt = 0; attempt < SUBMISSION_MAX_ATTEMPTS; attempt++) {
    const result = await sorobanServer.getTransaction(submission.hash)

    if (result.status === 'SUCCESS') {
      return { transactionHash: submission.hash }
    }

    if (result.status === 'FAILED') {
      throw new Error(
        `Batch transaction failed on TESTNET: ${formatRpcError(result)}`
      )
    }

    await delay(SUBMISSION_RETRY_DELAY_MS)
  }

  throw new Error(
    `Batch transaction timeout: ${submission.hash} was not confirmed after ${SUBMISSION_MAX_ATTEMPTS} attempts`
  )
}

export async function runBatchEvidence(
  options: RunBatchEvidenceOptions
): Promise<BatchEvidenceLine[]> {
  const input = await loadBatchEvidenceInput(options.inputPath)
  const outputPath = options.outputPath ?? DEFAULT_EVIDENCE_PATH
  const contractId = options.contractId ?? STELLAR_CONFIG.TIPPING_CONTRACT_ID
  const secretKey = options.secretKey ?? process.env.ENG236_TIPPER_SECRET_KEY
  const deps = options.deps ?? createDefaultDependencies()

  if (!contractId) {
    throw new Error('NEXT_PUBLIC_TIPPING_CONTRACT_ID is required')
  }

  if (!options.dryRun && !secretKey) {
    throw new Error('ENG236_TIPPER_SECRET_KEY is required for live submission')
  }

  await mkdir(path.dirname(outputPath), { recursive: true })

  const lines: BatchEvidenceLine[] = []
  for (const [index, batch] of input.batches.entries()) {
    const built =
      batch.tipType === 'article'
        ? await deps.buildArticleBatchTipTransaction(
            input.tipperPublicKey,
            batch.tips
          )
        : await deps.buildHighlightBatchTipTransaction(
            input.tipperPublicKey,
            batch.tips
          )

    let transactionHash: string | null = null
    if (!options.dryRun) {
      const signedXdr = await deps.signPreparedXdr(
        built.xdr,
        secretKey as string,
        input.tipperPublicKey
      )
      const submitted = await deps.submitSignedBatchTransaction(signedXdr)
      transactionHash = submitted.transactionHash
    }

    const line: BatchEvidenceLine = {
      issue: ISSUE_ID,
      recordedAt: deps.now().toISOString(),
      network: STELLAR_CONFIG.NETWORK,
      dryRun: options.dryRun,
      batchId: batch.id ?? `${batch.tipType}-${index + 1}`,
      tipType: batch.tipType,
      batchSize: batch.tips.length,
      contractId,
      tipperPublicKey: input.tipperPublicKey,
      transactionHash,
      stellarExpertUrl: transactionHash
        ? buildStellarExpertTransactionUrl(
            transactionHash,
            STELLAR_CONFIG.NETWORK
          )
        : null,
      stroops: built.stroops,
      authorReceived: built.authorReceived,
      platformFee: built.platformFee,
      items: built.items,
    }

    await appendFile(outputPath, `${JSON.stringify(line)}\n`, 'utf8')
    lines.push(line)
  }

  return lines
}

export function parseCliArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    outputPath: DEFAULT_EVIDENCE_PATH,
    dryRun: false,
    writeTemplate: false,
    templatePath: DEFAULT_TEMPLATE_PATH,
    help: false,
  }

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (!arg) continue

    switch (arg) {
      case '--help':
      case '-h':
        options.help = true
        break
      case '--dry-run':
        options.dryRun = true
        break
      case '--write-template':
        options.writeTemplate = true
        break
      case '--input':
        options.inputPath = readOptionValue(args, index, arg)
        index++
        break
      case '--output':
        options.outputPath = readOptionValue(args, index, arg)
        index++
        break
      case '--template':
        options.templatePath = readOptionValue(args, index, arg)
        index++
        break
      default:
        throw new Error(`Unknown option: ${arg}`)
    }
  }

  return options
}

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2))

  if (options.help) {
    console.log(buildBatchEvidenceHelpText())
    return
  }

  if (options.writeTemplate) {
    await writeBatchEvidenceTemplate(options.templatePath)
    console.log(`Wrote ${ISSUE_ID} input template to ${options.templatePath}`)
    return
  }

  if (!options.inputPath) {
    throw new Error(
      `Missing required --input path. Generate a local template first with: bun run eng-236:batch-evidence -- --write-template`
    )
  }

  const lines = await runBatchEvidence({
    inputPath: options.inputPath,
    outputPath: options.outputPath,
    dryRun: options.dryRun,
  })

  for (const line of lines) {
    const tx = line.transactionHash ?? 'dry-run'
    console.log(
      `${line.batchId}: ${line.tipType} batch size ${line.batchSize} recorded (${tx})`
    )
    if (line.stellarExpertUrl) {
      console.log(`  ${line.stellarExpertUrl}`)
    }
  }
  console.log(
    `Appended ${lines.length} ${ISSUE_ID} evidence line(s) to ${options.outputPath}`
  )
}

function createDefaultDependencies(): BatchEvidenceRunnerDependencies {
  const client = new StellarClient()

  return {
    buildArticleBatchTipTransaction:
      client.buildArticleBatchTipTransaction.bind(client),
    buildHighlightBatchTipTransaction:
      client.buildHighlightBatchTipTransaction.bind(client),
    signPreparedXdr,
    submitSignedBatchTransaction,
    now: () => new Date(),
  }
}

function readOptionValue(
  args: string[],
  index: number,
  optionName: string
): string {
  const value = args[index + 1]
  if (!value || value.startsWith('--')) {
    throw new Error(`${optionName} requires a value`)
  }
  return value
}

function formatRpcError(error: unknown): string {
  if (error === undefined || error === null) return 'no error details'
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function buildBatchEvidenceHelpText(): string {
  return [
    `${ISSUE_ID} local batch evidence runner`,
    '',
    'Prepare local input:',
    '  bun run eng-236:batch-evidence -- --write-template',
    '',
    'Dry-run build and evidence shape:',
    `  bun run eng-236:batch-evidence -- --input ${DEFAULT_TEMPLATE_PATH} --dry-run`,
    '',
    'Live TESTNET submission:',
    `  ENG236_TIPPER_SECRET_KEY=<local TESTNET secret> bun run eng-236:batch-evidence -- --input ${DEFAULT_TEMPLATE_PATH}`,
    '',
    'Options:',
    '  --write-template        Write a local input template',
    '  --template <path>       Template output path',
    '  --input <path>          Local JSON input path',
    '  --output <path>         Evidence JSONL output path',
    '  --dry-run               Build transactions and append evidence without signing/submitting',
    '  --help                  Show this help',
  ].join('\n')
}

const scriptPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
const currentPath = fileURLToPath(import.meta.url)

if (scriptPath === currentPath) {
  main().catch((error) => {
    console.error(formatError(error))
    process.exitCode = 1
  })
}
