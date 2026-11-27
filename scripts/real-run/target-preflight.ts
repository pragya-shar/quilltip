/**
 * Target preflight for runs against a real testnet backend. Checks, from a
 * running dev server, that the frontend, its client configuration, the
 * Convex backend it talks to and the chain all name the same target, and
 * refuses everything else. The real-run Playwright suite calls it before
 * any step that writes (`e2e/real-run/global-setup.ts`).
 *
 *   bun scripts/real-run/target-preflight.ts --base-url http://127.0.0.1:3240 \
 *     --expect <env file with the intended target>
 *
 * Checks, each of which fails the run:
 * 1. Frontend: every Convex host the page talks to (HTTP and WebSocket) is
 *    the expected deployment, and no other known deployment name appears in
 *    the requests, the HTML or the served JavaScript.
 * 2. Client config: the values `v2Config()` inlines (network, passphrase,
 *    Core and Tab) equal the expected ones, and the served JavaScript holds
 *    no contract id of the v2 testnet set (docs/contracts).
 * 3. Backend: `chain/config:getChainConfig`, read from the same page,
 *    names the same network, Core and Tab.
 * 4. Chain: the Tab's `config()` simulates on testnet and pays in the token
 *    the backend names.
 *
 * Read-only: one page load, one Convex query, one simulation. No key is read.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { loadEnvConfig } from '@next/env'
import { chromium } from '@playwright/test'
import { rpc } from '@stellar/stellar-sdk'
import {
  ALLOWED_CONVEX_DEPLOYMENTS,
  LIVE_CONVEX_DEPLOYMENTS,
} from '../../convex/lib/networkGuard'
import { readV2Config } from '../../lib/stellar/v2/config'
import { readTabView } from '../../lib/tab-ui/tab-calls'

const ROOT = path.resolve(import.meta.dirname, '../..')
const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015'

export type Expected = {
  convexHost: string
  network: string
  passphrase: string
  coreContractId: string
  tabContractId: string
}

export type PreflightReport = {
  at: string
  baseUrl: string
  pass: boolean
  failures: string[]
  hostsSeen: string[]
  expected: Expected
  client: {
    network: string
    passphrase: string
    coreContractId: string | null
    tabContractId: string | null
    tokenContractId: string | null
  }
  backend: {
    network: string
    chainEpoch: string
    coreContractId: string | null
    tabContractId: string | null
    tokenContractId: string | null
  } | null
  chain: { tabToken: string | null; minDeposit: string | null } | null
}

function parseEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (m) out[m[1]!] = m[2]!.replace(/^['"]|['"]$/g, '')
  }
  return out
}

/** The deployment name of `CONVEX_DEPLOYMENT` (`dev:name` or `name`). */
function deploymentName(value: string | undefined): string {
  return (value ?? '').replace(/^[a-z]+:/, '').trim()
}

export function expectedFrom(env: Record<string, string>): Expected {
  return {
    convexHost: `${deploymentName(env.CONVEX_DEPLOYMENT)}.convex.cloud`,
    network: env.NEXT_PUBLIC_STELLAR_NETWORK ?? '',
    passphrase: env.NEXT_PUBLIC_NETWORK_PASSPHRASE || TESTNET_PASSPHRASE,
    coreContractId: env.NEXT_PUBLIC_CORE_CONTRACT_ID ?? '',
    tabContractId: env.NEXT_PUBLIC_TAB_CONTRACT_ID ?? '',
  }
}

/** Core, Tab and NFT ids of the v2 testnet set, from its deployment record. */
export function v2ContractIds(): string[] {
  const doc = readFileSync(
    path.join(ROOT, 'docs/contracts/v2-testnet-deployment.md'),
    'utf8'
  )
  const ids = new Set<string>()
  for (const line of doc.split('\n')) {
    const row = /^\|\s*(core|tab|nft)\s*\|.*?`(C[A-Z2-7]{55})`/.exec(line)
    if (row) ids.add(row[2]!)
  }
  return [...ids]
}

/** What `v2Config()` inlines: Next.js loads the same env files. */
function clientConfig() {
  const { combinedEnv } = loadEnvConfig(ROOT, true, { info() {}, error() {} })
  const env = combinedEnv as Record<string, string | undefined>
  const config = readV2Config({
    network: env.NEXT_PUBLIC_STELLAR_NETWORK,
    passphrase: env.NEXT_PUBLIC_NETWORK_PASSPHRASE,
    rpcUrl: env.NEXT_PUBLIC_STELLAR_RPC_URL,
    legacyRpcUrl: env.NEXT_PUBLIC_SOROBAN_RPC_URL,
    horizonUrl: env.NEXT_PUBLIC_HORIZON_URL,
    convexUrl: env.NEXT_PUBLIC_CONVEX_URL,
    coreContractId: env.NEXT_PUBLIC_CORE_CONTRACT_ID,
    tabContractId: env.NEXT_PUBLIC_TAB_CONTRACT_ID,
    nftContractId: env.NEXT_PUBLIC_ARTICLE_NFT_CONTRACT_ID,
    tokenContractId: env.NEXT_PUBLIC_TOKEN_CONTRACT_ID,
    v1NftContractId: env.NEXT_PUBLIC_NFT_CONTRACT_ID,
  })
  return { config, convexUrl: env.NEXT_PUBLIC_CONVEX_URL ?? '' }
}

export async function runTargetPreflight(options: {
  baseUrl: string
  expected: Expected
  /** Page to load; one that queries Convex. */
  pagePath?: string
}): Promise<PreflightReport> {
  const failures: string[] = []
  const { expected } = options
  const otherDeployments = [
    ...ALLOWED_CONVEX_DEPLOYMENTS,
    ...LIVE_CONVEX_DEPLOYMENTS,
  ].filter((name) => `${name}.convex.cloud` !== expected.convexHost)
  const forbiddenIds = v2ContractIds().filter(
    (id) => id !== expected.tabContractId && id !== expected.coreContractId
  )

  // 2. Client configuration, as Next.js inlines it.
  const { config, convexUrl } = clientConfig()
  const client = {
    network: config.network,
    passphrase: config.passphrase,
    coreContractId: config.coreContractId,
    tabContractId: config.tabContractId,
    tokenContractId: config.tokenContractId,
  }
  if (new URL(convexUrl).host !== expected.convexHost)
    failures.push(
      `client Convex URL ${convexUrl} is not ${expected.convexHost}`
    )
  if (client.network !== 'TESTNET')
    failures.push(`client network ${client.network}`)
  if (client.passphrase !== expected.passphrase)
    failures.push('client passphrase differs')
  if (client.coreContractId !== expected.coreContractId)
    failures.push(`client Core ${client.coreContractId}`)
  if (client.tabContractId !== expected.tabContractId)
    failures.push(`client Tab ${client.tabContractId}`)
  for (const id of forbiddenIds)
    if (id === client.tabContractId || id === client.coreContractId)
      failures.push(`client names a v2 contract ${id}`)

  // 1. The frontend: hosts, HTML and served JavaScript.
  const browser = await chromium.launch()
  const hosts = new Set<string>()
  const texts: string[] = []
  let backend: PreflightReport['backend'] = null
  try {
    const context = await browser.newContext()
    const page = await context.newPage()
    page.on('request', (r) => hosts.add(new URL(r.url()).host))
    page.on('websocket', (ws) => hosts.add(new URL(ws.url()).host))
    page.on('response', async (r) => {
      const type = r.request().resourceType()
      if (type === 'script' || type === 'document') {
        try {
          texts.push(await r.text())
        } catch {
          // A redirect or an aborted response has no body.
        }
      }
    })
    await page.goto(
      new URL(options.pagePath ?? '/articles', options.baseUrl).href,
      {
        waitUntil: 'load',
        timeout: 120_000,
      }
    )
    await page.waitForTimeout(6_000)
    texts.push(await page.content())

    // 3. The backend, read from the same page.
    const convexHosts = [...hosts].filter((h) =>
      /\.convex\.(cloud|site)$/.test(h)
    )
    for (const host of convexHosts)
      if (host !== expected.convexHost)
        failures.push(`the page talked to ${host}`)
    if (!convexHosts.includes(expected.convexHost))
      failures.push(`the page never talked to ${expected.convexHost}`)
    const answer = await page.evaluate(async (host) => {
      const res = await fetch(`https://${host}/api/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: 'chain/config:getChainConfig',
          args: {},
          format: 'json',
        }),
      })
      return res.json()
    }, expected.convexHost)
    const value = (answer as { status?: string; value?: unknown }).value as
      | NonNullable<PreflightReport['backend']>
      | undefined
    if ((answer as { status?: string }).status !== 'success' || !value) {
      failures.push('getChainConfig did not answer')
    } else {
      backend = {
        network: value.network,
        chainEpoch: value.chainEpoch,
        coreContractId: value.coreContractId,
        tabContractId: value.tabContractId,
        tokenContractId: value.tokenContractId,
      }
    }
    await context.close()
  } finally {
    await browser.close()
  }
  const served = texts.join('\n')
  for (const name of otherDeployments)
    if (served.includes(name)) failures.push(`served code names ${name}`)
  for (const id of forbiddenIds)
    if (served.includes(id))
      failures.push(`served code names v2 contract ${id}`)

  if (backend) {
    if (backend.network !== 'TESTNET')
      failures.push(`backend network ${backend.network}`)
    if (backend.coreContractId !== expected.coreContractId)
      failures.push(`backend Core ${backend.coreContractId}`)
    if (backend.tabContractId !== expected.tabContractId)
      failures.push(`backend Tab ${backend.tabContractId}`)
    if (backend.coreContractId !== client.coreContractId)
      failures.push('backend and client Core differ')
    if (backend.tabContractId !== client.tabContractId)
      failures.push('backend and client Tab differ')
    if (forbiddenIds.includes(backend.tabContractId ?? ''))
      failures.push('backend names the v2 Tab')
  }

  // 4. The chain: the Tab the backend names, by simulation.
  let chain: PreflightReport['chain'] = null
  if (backend?.tabContractId) {
    try {
      const server = new rpc.Server(config.rpcUrl, {
        allowHttp: config.allowHttp,
      })
      const view = (await readTabView(server, {
        tabContractId: backend.tabContractId,
        networkPassphrase: config.passphrase,
        method: 'config',
      })) as { token?: string; min_deposit?: bigint }
      chain = {
        tabToken: view.token ?? null,
        minDeposit:
          view.min_deposit !== undefined ? String(view.min_deposit) : null,
      }
      if (backend.tokenContractId && view.token !== backend.tokenContractId)
        failures.push(
          `Tab token ${view.token} is not ${backend.tokenContractId}`
        )
    } catch (error) {
      failures.push(`Tab config() did not simulate: ${String(error)}`)
    }
  }

  return {
    at: new Date().toISOString(),
    baseUrl: options.baseUrl,
    pass: failures.length === 0,
    failures,
    hostsSeen: [...hosts].sort(),
    expected,
    client,
    backend,
    chain,
  }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

if (import.meta.main) {
  const expectFile = arg('--expect') ?? path.join(ROOT, '.env.local')
  const report = await runTargetPreflight({
    baseUrl: arg('--base-url') ?? 'http://127.0.0.1:3240',
    expected: expectedFrom(parseEnvFile(expectFile)),
    pagePath: arg('--page'),
  })
  console.log(JSON.stringify(report, null, 2))
  console.log(report.pass ? 'TARGET CHECK: PASS' : 'TARGET CHECK: FAIL')
  process.exit(report.pass ? 0 : 1)
}

export { parseEnvFile }
