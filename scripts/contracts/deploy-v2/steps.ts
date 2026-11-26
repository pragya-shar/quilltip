/**
 * Deployment steps (docs/architecture/v2/08-testing-and-deployment.md,
 * section 8.4). Each step records its result in the state file and is skipped
 * when the state shows it finished, so a rerun resumes after a failure.
 */
import { spawnSync, execFileSync } from 'child_process'
import { createHash, randomBytes } from 'crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

import {
  CONTRACTS,
  CONTRACT_ROLES,
  CORE_MIN_TIP,
  FEE_BPS,
  NFT_NAME,
  NFT_SYMBOL,
  NFT_THRESHOLD,
  ROLE_KEYS,
  ROLE_SYMBOLS,
  SCHEMA_VERSION,
  SMOKE_KEYS,
  TAB_MAX_BALANCE,
  TAB_MIN_DEPOSIT,
  UNFUNDED_KEYS,
  UNFUNDED_SMOKE_KEYS,
  WASM_FILES,
  identityName,
  type ContractName,
  type ContractSet,
} from './config'
import { voucherJson } from './encoding'
import { ensureKey, rawPublicKeyHex, signer } from './keys'
import {
  cli,
  latestLedger,
  submit,
  submitIfNeeded,
  view,
  type CliContext,
  type TxRecord,
} from './network'
import { saveState, type CheckRecord, type DeployState } from './state'

export type StepContext = {
  ctx: CliContext
  set: ContractSet
  state: DeployState
  statePath: string
  repoRoot: string
  log: (line: string) => void
}

function save(s: StepContext): void {
  saveState(s.statePath, s.state)
}

const id = (s: StepContext, key: string) => identityName(s.set, key)

// ---------------------------------------------------------------- build

function parseSums(outDir: string) {
  const sizes = readFileSync(join(outDir, 'sizes.tsv'), 'utf8')
    .trim()
    .split('\n')
    .slice(1)
    .map((line) => line.split('\t'))
  const byFile = new Map(
    sizes.map(([file, bytes, sha]) => [
      file,
      { bytes: Number(bytes), sha256: sha ?? '' },
    ])
  )
  const wasm = {} as Record<ContractName, { sha256: string; bytes: number }>
  for (const c of CONTRACTS) {
    const entry = byFile.get(WASM_FILES[c])
    if (!entry)
      throw new Error(`${WASM_FILES[c]} is missing from ${outDir}/sizes.tsv`)
    wasm[c] = entry
  }
  return wasm
}

function runBuild(s: StepContext, commit: string, outDir: string): string {
  const result = spawnSync(
    join(s.repoRoot, 'scripts/contracts/build-reproducible.sh'),
    ['--commit', commit, '--out', outDir],
    { cwd: s.repoRoot, encoding: 'utf8' }
  )
  if (result.status !== 0) {
    throw new Error(
      `Reproducible build failed:\n${(result.stderr || result.stdout).slice(-2000)}`
    )
  }
  return result.stdout
}

/**
 * Builds the recorded commit twice in the pinned container and requires the
 * same hashes both times.
 */
export function stepBuild(
  s: StepContext,
  commit: string,
  buildRoot: string
): void {
  if (
    s.state.build?.commit === commit &&
    existsSync(join(s.state.build.outDir, 'sizes.tsv'))
  ) {
    s.log(`build: ${commit.slice(0, 12)} already built`)
    return
  }
  const outDir = join(buildRoot, `wasm-${commit}`)
  s.log(`build: ${commit.slice(0, 12)} (first build)`)
  const out = runBuild(s, commit, outDir)
  const first = parseSums(outDir)
  s.log('build: second build to confirm the hashes')
  const again = mkdtempSync(join(tmpdir(), 'qt-wasm-'))
  try {
    runBuild(s, commit, again)
    const second = parseSums(again)
    for (const c of CONTRACTS) {
      if (first[c].sha256 !== second[c].sha256) {
        throw new Error(
          `${WASM_FILES[c]} hash differs between two builds of ${commit}`
        )
      }
    }
  } finally {
    rmSync(again, { recursive: true, force: true })
  }
  const image = out.match(/^Image:\s+(\S+)/m)?.[1] ?? 'unknown'
  const stellarCli = out.match(/^CLI:\s+(.+)$/m)?.[1]?.trim() ?? 'unknown'
  s.state.commit = commit
  s.state.build = {
    commit,
    outDir,
    image,
    stellarCli,
    wasm: first,
    reproduced: true,
  }
  save(s)
}

// ---------------------------------------------------------------- keys

export async function stepKeys(s: StepContext): Promise<void> {
  const keys = { ...(s.state.keys ?? {}) }
  for (const key of ROLE_KEYS) {
    keys[key] = await ensureKey(s.ctx, s.set, key, !UNFUNDED_KEYS.includes(key))
  }
  for (const key of SMOKE_KEYS) {
    keys[`smoke-${key}`] = await ensureKey(
      s.ctx,
      s.set,
      `smoke-${key}`,
      !UNFUNDED_SMOKE_KEYS.includes(key)
    )
  }
  s.state.keys = keys
  s.state.nativeSac = cli(s.ctx, [
    'contract',
    'id',
    'asset',
    '--asset',
    'native',
  ]).stdout
  // Testnet has the native XLM asset contract. A fresh local network does
  // not, so it is deployed there once.
  if (!contractLive(s, s.state.nativeSac, 'decimals')) {
    await submitIfNeeded(s.ctx, [
      'contract',
      'asset',
      'deploy',
      '--asset',
      'native',
      '--source',
      id(s, 'deployer'),
    ])
    s.log(`keys: deployed the native asset contract ${s.state.nativeSac}`)
  }
  save(s)
  s.log(
    `keys: ${Object.keys(keys).length} identities ready; native SAC ${s.state.nativeSac}`
  )
}

// ---------------------------------------------------------------- upload

export async function stepUpload(s: StepContext): Promise<void> {
  const build = requireBuild(s)
  s.state.uploads ??= {}
  for (const c of CONTRACTS) {
    if (s.state.uploads[c]?.wasmHash === build.wasm[c].sha256) continue
    const path = join(build.outDir, WASM_FILES[c])
    const result = await submitIfNeeded(s.ctx, [
      'contract',
      'upload',
      '--wasm',
      path,
      '--source',
      id(s, 'deployer'),
    ])
    if (result.stdout !== build.wasm[c].sha256) {
      throw new Error(
        `Uploaded ${c} hash ${result.stdout} is not the built ${build.wasm[c].sha256}`
      )
    }
    s.state.uploads[c] = { wasmHash: result.stdout, tx: result.tx }
    save(s)
    s.log(`upload: ${c} ${result.stdout}`)
  }
}

// ---------------------------------------------------------------- deploy

function requireBuild(s: StepContext) {
  if (!s.state.build) throw new Error('Run the build step first.')
  return s.state.build
}

type Keys = { get(name: string): string }

function requireKeys(s: StepContext): Keys {
  const keys = s.state.keys
  if (!keys || !s.state.nativeSac) throw new Error('Run the keys step first.')
  return {
    get(name: string) {
      const value = keys[name]
      if (!value) throw new Error(`Key ${name} is missing; run the keys step.`)
      return value
    },
  }
}

/** Deterministic salt, so a rerun after a lost state file finds the contract. */
export function deploySalt(
  set: ContractSet,
  contract: ContractName,
  commit: string
): string {
  return createHash('sha256')
    .update(`quilltip-v2:${set}:${contract}:${commit}`)
    .digest('hex')
}

function constructorArgs(
  s: StepContext,
  c: ContractName,
  nftBaseUri: string
): string[] {
  const k = requireKeys(s)
  const xlm = s.state.nativeSac!
  const common = [
    '--admin',
    k.get('admin'),
    '--pauser',
    k.get('pauser'),
    '--upgrader',
    k.get('upgrader'),
  ]
  switch (c) {
    case 'core':
      return [
        ...common,
        '--treasury',
        k.get('treasury'),
        '--token',
        xlm,
        '--min_tip',
        CORE_MIN_TIP.toString(),
      ]
    case 'tab':
      return [
        ...common,
        '--settler',
        k.get('settler'),
        '--token',
        xlm,
        '--treasury',
        k.get('treasury'),
        '--max_balance',
        TAB_MAX_BALANCE.toString(),
        '--min_deposit',
        TAB_MIN_DEPOSIT.toString(),
        '--acceptor_key',
        rawPublicKeyHex(k.get('acceptor')),
      ]
    case 'nft':
      return [
        ...common,
        '--core',
        s.state.contracts!.core!.id,
        '--threshold_token',
        xlm,
        '--threshold',
        NFT_THRESHOLD.toString(),
        '--base_uri',
        nftBaseUri,
      ]
  }
}

function contractLive(
  s: StepContext,
  contractId: string,
  probe = 'schema_version'
): boolean {
  try {
    view(s.ctx, contractId, id(s, 'deployer'), probe)
    return true
  } catch {
    return false
  }
}

/** Deploys Core, then Tab and the NFT with the Core address. */
export async function stepDeploy(
  s: StepContext,
  nftBaseUri: string
): Promise<void> {
  const build = requireBuild(s)
  requireKeys(s)
  s.state.contracts ??= {}
  s.state.config = { nftBaseUri }
  for (const c of CONTRACTS) {
    if (s.state.contracts[c]) continue
    const wasmHash = s.state.uploads?.[c]?.wasmHash
    if (wasmHash !== build.wasm[c].sha256) throw new Error(`Upload ${c} first.`)
    const salt = deploySalt(s.set, c, build.commit)
    const expectedId = cli(s.ctx, [
      'contract',
      'id',
      'wasm',
      '--salt',
      salt,
      '--source',
      id(s, 'deployer'),
    ]).stdout
    if (contractLive(s, expectedId)) {
      s.log(
        `deploy: ${c} already at ${expectedId} (recorded without its transaction)`
      )
      s.state.contracts[c] = { id: expectedId, salt, tx: null }
      save(s)
      continue
    }
    const result = await submit(s.ctx, [
      'contract',
      'deploy',
      '--wasm-hash',
      wasmHash,
      '--salt',
      salt,
      '--source',
      id(s, 'deployer'),
      '--',
      ...constructorArgs(s, c, nftBaseUri),
    ])
    if (result.stdout !== expectedId) {
      throw new Error(
        `${c} deployed at ${result.stdout}, expected ${expectedId}`
      )
    }
    s.state.contracts[c] = { id: result.stdout, salt, tx: result.tx }
    save(s)
    s.log(`deploy: ${c} ${result.stdout} (ledger ${result.tx.ledger})`)
  }
}

// ---------------------------------------------------------------- verify

/** JSON with object keys sorted, so key order never decides a comparison. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => (a < b ? -1 : 1)
    )
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function check(name: string, expected: unknown, actual: unknown): CheckRecord {
  const e = canonical(expected)
  const a = canonical(actual)
  return { name, expected: e, actual: a, ok: e === a }
}

/** Reads back every view and compares it, and the on-chain Wasm, with the plan. */
export function stepVerify(s: StepContext): CheckRecord[] {
  const build = requireBuild(s)
  const k = requireKeys(s)
  const xlm = s.state.nativeSac!
  const ids = s.state.contracts ?? {}
  for (const c of CONTRACTS) if (!ids[c]) throw new Error(`Deploy ${c} first.`)
  const src = id(s, 'deployer')
  const core = ids.core!.id
  const tab = ids.tab!.id
  const nft = ids.nft!.id
  const v = <T>(cid: string, fn: string, args: string[] = []) =>
    view<T>(s.ctx, cid, src, fn, args)

  const checks: CheckRecord[] = [
    check('core.fee_bps', FEE_BPS, v(core, 'fee_bps')),
    check(
      'core.min_tip(XLM)',
      CORE_MIN_TIP.toString(),
      String(v(core, 'min_tip', ['--token', xlm]))
    ),
    check(
      'core.token_config(XLM)',
      { enabled: true, min_tip: CORE_MIN_TIP.toString() },
      v(core, 'token_config', ['--token', xlm])
    ),
    check('core.treasury', k.get('treasury'), v(core, 'treasury')),
    check(
      'tab.config',
      {
        acceptor_keys: [rawPublicKeyHex(k.get('acceptor'))],
        max_balance: TAB_MAX_BALANCE.toString(),
        min_deposit: TAB_MIN_DEPOSIT.toString(),
        token: xlm,
        treasury: k.get('treasury'),
      },
      v(tab, 'config')
    ),
    check(
      'nft.threshold',
      [xlm, NFT_THRESHOLD.toString()],
      v(nft, 'threshold')
    ),
    check('nft.name', NFT_NAME, v(nft, 'name')),
    check('nft.symbol', NFT_SYMBOL, v(nft, 'symbol')),
  ]
  const roleHolder: Record<keyof typeof ROLE_SYMBOLS, string> = {
    pauser: k.get('pauser'),
    upgrader: k.get('upgrader'),
    settler: k.get('settler'),
  }
  for (const c of CONTRACTS) {
    const cid = ids[c]!.id
    checks.push(
      check(`${c}.schema_version`, SCHEMA_VERSION, v(cid, 'schema_version'))
    )
    checks.push(check(`${c}.get_admin`, k.get('admin'), v(cid, 'get_admin')))
    checks.push(check(`${c}.paused`, false, v(cid, 'paused')))
    const roles = CONTRACT_ROLES[c]
    const existing = (v<string[]>(cid, 'get_existing_roles') ?? [])
      .slice()
      .sort()
    checks.push(
      check(
        `${c}.get_existing_roles`,
        [...roles].map((r) => ROLE_SYMBOLS[r]).sort(),
        existing
      )
    )
    for (const role of roles) {
      checks.push(
        check(
          `${c}.role ${role} holder`,
          roleHolder[role],
          v(cid, 'get_role_member', [
            '--role',
            ROLE_SYMBOLS[role],
            '--index',
            '0',
          ])
        )
      )
      checks.push(
        check(
          `${c}.role ${role} count`,
          1,
          v(cid, 'get_role_member_count', ['--role', ROLE_SYMBOLS[role]])
        )
      )
    }
    // The on-chain code is the locally built Wasm.
    const dir = mkdtempSync(join(tmpdir(), 'qt-fetch-'))
    try {
      const out = join(dir, `${c}.wasm`)
      cli(s.ctx, ['contract', 'fetch', '--id', cid, '-o', out])
      const onChain = createHash('sha256')
        .update(readFileSync(out))
        .digest('hex')
      checks.push(check(`${c}.wasm sha256`, build.wasm[c].sha256, onChain))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  const ok = checks.every((c) => c.ok)
  s.state.verify = { at: new Date().toISOString(), checks, ok }
  save(s)
  for (const c of checks.filter((c) => !c.ok)) {
    s.log(`verify: MISMATCH ${c.name}: expected ${c.expected}, got ${c.actual}`)
  }
  s.log(
    `verify: ${checks.filter((c) => c.ok).length}/${checks.length} checks match`
  )
  if (!ok) throw new Error('Verification failed; see the mismatches above.')
  return checks
}

// ---------------------------------------------------------------- smoke

/** Stroop amounts used by the smoke flows. */
const XLM = BigInt(10_000_000)
export const SMOKE = {
  /** A tip at the NFT threshold, so the mint flow can run. */
  tip: NFT_THRESHOLD,
  highlightTip: BigInt(1) * XLM,
  batchItem: BigInt(1) * XLM,
  tabDeposit: BigInt(10) * XLM,
  tabSpendLimit: BigInt(5) * XLM,
  voucher1: BigInt(1) * XLM,
  voucher2: BigInt(2) * XLM,
} as const

function digest(label: string): string {
  return createHash('sha256').update(label).digest('hex')
}

function clientRef(): string {
  return randomBytes(16).toString('hex')
}

/**
 * Runs the twelve smoke flows of section 8.4 with throwaway accounts. A flow
 * recorded in the state is not run again.
 */
export async function stepSmoke(s: StepContext): Promise<void> {
  const k = requireKeys(s)
  const ids = s.state.contracts ?? {}
  if (!s.state.verify?.ok) throw new Error('Run the verify step first.')
  const xlm = s.state.nativeSac!
  const core = ids.core!.id
  const tab = ids.tab!.id
  const nft = ids.nft!.id
  s.state.smoke ??= {}
  s.state.smokeData ??= {}
  const data = s.state.smokeData
  const need = (key: string): string => {
    const value = data[key]
    if (value === undefined) throw new Error(`Smoke value ${key} is missing`)
    return value
  }
  const author = k.get('smoke-author')
  const tipper = k.get('smoke-tipper')
  const reader = k.get('smoke-reader')
  const runTag = `${s.set}:${s.state.build!.commit}`

  const flow = async (
    name: string,
    detail: string,
    run: () => Promise<{ tx: TxRecord | null; stdout?: string }>
  ) => {
    if (s.state.smoke![name]) {
      s.log(`smoke: ${name} already recorded`)
      return
    }
    const result = await run()
    s.state.smoke![name] = { flow: name, tx: result.tx, detail }
    save(s)
    s.log(
      `smoke: ${name}${result.tx ? ` ${result.tx.hash} (fee ${result.tx.feeCharged} stroops)` : ' (off chain)'}`
    )
  }
  const invoke = (
    contract: string,
    source: string,
    fn: string,
    args: string[]
  ) =>
    submit(s.ctx, [
      'contract',
      'invoke',
      '--id',
      contract,
      '--source',
      id(s, source),
      '--',
      fn,
      ...args,
    ])

  await flow(
    'register',
    'Core register_article by the author, no splits',
    async () => {
      const r = await invoke(core, 'smoke-author', 'register_article', [
        '--author',
        author,
        '--article_ref',
        digest(`smoke-article:${runTag}`),
        '--content_hash',
        digest(`smoke-content:${runTag}`),
        '--splits',
        '[]',
      ])
      data.articleId = JSON.parse(r.stdout)
      return r
    }
  )
  const articleId = need('articleId')
  await flow(
    'tip',
    `Core tip of ${SMOKE.tip} stroops (the NFT threshold)`,
    () =>
      invoke(core, 'smoke-tipper', 'tip', [
        '--tipper',
        tipper,
        '--article_id',
        articleId,
        '--token',
        xlm,
        '--amount',
        SMOKE.tip.toString(),
        '--client_ref',
        clientRef(),
      ])
  )
  await flow(
    'highlight tip',
    `Core tip of ${SMOKE.highlightTip} stroops with a highlight ID`,
    () =>
      invoke(core, 'smoke-tipper', 'tip', [
        '--tipper',
        tipper,
        '--article_id',
        articleId,
        '--token',
        xlm,
        '--amount',
        SMOKE.highlightTip.toString(),
        '--highlight_id',
        // An Option argument takes JSON: a quoted hex string.
        JSON.stringify(digest(`smoke-highlight:${runTag}`)),
        '--client_ref',
        clientRef(),
      ])
  )
  await flow(
    'batch tip',
    `Core tip_batch with two items of ${SMOKE.batchItem} stroops`,
    () =>
      invoke(core, 'smoke-tipper', 'tip_batch', [
        '--tipper',
        tipper,
        '--token',
        xlm,
        '--items',
        JSON.stringify(
          [1, 2].map(() => ({
            article_id: articleId,
            amount: SMOKE.batchItem.toString(),
            highlight_id: null,
            client_ref: clientRef(),
          }))
        ),
      ])
  )

  const session = signer(s.ctx, id(s, 'smoke-session'))
  await flow(
    'open tab',
    `Tab open_session: deposit ${SMOKE.tabDeposit} stroops, spend limit ${SMOKE.tabSpendLimit}`,
    async () => {
      const validUntil = (await latestLedger(s.ctx.net)) + 17_280
      const r = await invoke(tab, 'smoke-reader', 'open_session', [
        '--reader',
        reader,
        '--amount',
        SMOKE.tabDeposit.toString(),
        '--public_key',
        Buffer.from(session.rawPublicKey()).toString('hex'),
        '--valid_until',
        String(validUntil),
        '--spend_limit',
        SMOKE.tabSpendLimit.toString(),
      ])
      data.keyId = String(JSON.parse(r.stdout))
      return r
    }
  )
  const keyId = Number(need('keyId'))
  const receiptsRoot = digest(`smoke-receipts:${runTag}`)
  const payloadFor = (cumulative: bigint) =>
    Buffer.from(
      view<string>(s.ctx, tab, id(s, 'smoke-reader'), 'voucher_payload', [
        '--reader',
        reader,
        '--writer',
        author,
        '--key_id',
        String(keyId),
        '--cumulative',
        cumulative.toString(),
        '--receipts_root',
        receiptsRoot,
      ]),
      'hex'
    )
  await flow(
    'tab tip',
    `Session key signs a voucher for cumulative ${SMOKE.voucher1} stroops (off chain)`,
    async () => {
      data.voucher1 = JSON.stringify(
        voucherJson({
          reader,
          writer: author,
          keyId,
          cumulative: SMOKE.voucher1,
          receiptsRoot,
          payload: payloadFor(SMOKE.voucher1),
          session,
        })
      )
      return { tx: null }
    }
  )
  await flow('settle', 'Tab settle by the settler with the voucher', () =>
    invoke(tab, 'settler', 'settle', [
      '--settler',
      k.get('settler'),
      '--vouchers',
      `[${need('voucher1')}]`,
    ])
  )
  await flow(
    'settle_own',
    `Tab settle_own by the writer, cumulative ${SMOKE.voucher2}, countersigned by the acceptor`,
    () => {
      const voucher = voucherJson({
        reader,
        writer: author,
        keyId,
        cumulative: SMOKE.voucher2,
        receiptsRoot,
        payload: payloadFor(SMOKE.voucher2),
        session,
        acceptor: signer(s.ctx, id(s, 'acceptor')),
      })
      return invoke(tab, 'smoke-author', 'settle_own', [
        '--writer',
        author,
        '--vouchers',
        JSON.stringify([voucher]),
      ])
    }
  )
  await flow('claim', "Tab claim of the writer's claimable balance", () =>
    invoke(tab, 'smoke-author', 'claim', ['--recipient', author])
  )
  await flow('withdraw start', 'Tab withdraw_start by the reader', () =>
    invoke(tab, 'smoke-reader', 'withdraw_start', ['--reader', reader])
  )
  await flow(
    'mint',
    'NFT mint by the author at the 50 XLM threshold',
    async () => {
      const r = await invoke(nft, 'smoke-author', 'mint', [
        '--article_id',
        articleId,
      ])
      data.tokenId = String(JSON.parse(r.stdout))
      return r
    }
  )
  await flow('transfer', 'NFT transfer from the author to the tipper', () =>
    invoke(nft, 'smoke-author', 'transfer', [
      '--from',
      author,
      '--to',
      tipper,
      '--token_id',
      need('tokenId'),
    ])
  )

  // Read-back after the flows.
  const results = {
    articleTotal: view(s.ctx, core, id(s, 'deployer'), 'article_total', [
      '--article_id',
      articleId,
      '--token',
      xlm,
    ]),
    paid: view(s.ctx, tab, id(s, 'deployer'), 'paid', [
      '--reader',
      reader,
      '--key_id',
      String(keyId),
      '--writer',
      author,
    ]),
    nftOwner: view(s.ctx, nft, id(s, 'deployer'), 'owner_of', [
      '--token_id',
      need('tokenId'),
    ]),
  }
  data.readback = JSON.stringify(results)
  save(s)
  s.log(`smoke: read-back ${data.readback}`)
}

export function gitCommitOnBase(
  repoRoot: string,
  commit: string,
  base: string
): boolean {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', commit, base], {
      cwd: repoRoot,
    })
    return true
  } catch {
    return false
  }
}
