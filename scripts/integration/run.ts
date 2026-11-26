/**
 * Runs the local-network integration suite
 * (docs/architecture/v2/08-testing-and-deployment.md, section 8.1).
 *
 *   bun scripts/integration/run.ts [--start] [--stop] [--out <dir>]
 *
 * --start  starts Quickstart in local mode (pinned image) unless an RPC
 *          already answers on localhost:8000, and waits until it is healthy.
 * --stop   removes the container afterwards.
 * --out    directory for measurements.json, events.json and event-fixtures.json
 *          (default contracts/target/integration).
 *
 * The network guard runs first in LOCAL mode; the suite refuses any other
 * network. Contracts are built with `stellar contract build` (offline). Set
 * QUILLTIP_WASM_DIR and QUILLTIP_CORE_UPGRADE_WASM to reuse built Wasm.
 */
import { spawnSync } from 'child_process'
import { mkdirSync } from 'fs'
import { join, resolve } from 'path'

import { Harness, guardedNetwork, localEnv } from './harness'

/** stellar/quickstart, pinned by digest (local mode, protocol 30). */
export const QUICKSTART_IMAGE =
  'docker.io/stellar/quickstart@sha256:d44068b0032099bb3722c95f5ded46b715393a1a977edc56512aea79b44e3f8b'
const CONTAINER = 'quilltip-local-network'
const repoRoot = resolve(__dirname, '../..')

function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: Record<string, string | undefined> } = {}
) {
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    cwd: opts.cwd ?? repoRoot,
    env: (opts.env ?? process.env) as NodeJS.ProcessEnv,
  })
  if (r.status !== 0)
    throw new Error(`${cmd} ${args.join(' ')} exited with ${r.status}`)
}

async function healthy(rpcUrl: string): Promise<boolean> {
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
    })
    const body = (await res.json()) as { result?: { status?: string } }
    return body.result?.status === 'healthy'
  } catch {
    return false
  }
}

async function waitHealthy(rpcUrl: string, seconds: number) {
  for (let i = 0; i < seconds; i++) {
    if (await healthy(rpcUrl)) return
    await new Promise((r) => setTimeout(r, 1_000))
  }
  throw new Error(`Local RPC at ${rpcUrl} is not healthy after ${seconds}s`)
}

async function main(argv: string[]) {
  const net = guardedNetwork('local-network integration runner')
  const outIndex = argv.indexOf('--out')
  const out = resolve(
    outIndex === -1
      ? join(repoRoot, 'contracts/target/integration')
      : (argv[outIndex + 1] as string)
  )
  mkdirSync(out, { recursive: true })

  if (argv.includes('--start') && !(await healthy(net.rpcUrl))) {
    run('docker', ['rm', '-f', CONTAINER])
    run('docker', [
      'run',
      '-d',
      '--rm',
      '--name',
      CONTAINER,
      '-p',
      '8000:8000',
      QUICKSTART_IMAGE,
      '--local',
      '--limits',
      'testnet',
      '--enable',
      'core,rpc',
    ])
  }
  await waitHealthy(net.rpcUrl, 300)
  await new Harness().assertLocalNetwork()

  let wasmDir = process.env.QUILLTIP_WASM_DIR
  let upgradeWasm = process.env.QUILLTIP_CORE_UPGRADE_WASM
  if (!wasmDir || !upgradeWasm) {
    wasmDir = join(out, 'wasm')
    const upgradeDir = join(out, 'wasm-upgrade')
    const contracts = join(repoRoot, 'contracts')
    run(
      'stellar',
      ['contract', 'build', '--locked', '--optimize', '--out-dir', wasmDir],
      { cwd: contracts }
    )
    run(
      'stellar',
      [
        'contract',
        'build',
        '--locked',
        '--package',
        'quilltip-core',
        '--features',
        'upgrade-test',
        '--out-dir',
        upgradeDir,
      ],
      { cwd: contracts }
    )
    upgradeWasm = join(upgradeDir, 'quilltip_core.wasm')
  }

  try {
    const env = {
      ...localEnv(),
      QUILLTIP_WASM_DIR: wasmDir,
      QUILLTIP_CORE_UPGRADE_WASM: upgradeWasm,
      QUILLTIP_INTEGRATION_OUT: out,
    }
    run(
      'bun',
      [
        'x',
        'vitest',
        'run',
        '--config',
        'scripts/integration/vitest.config.mts',
      ],
      { env }
    )
    // Tab settlement with the Convex ledger in convex-test (edge runtime).
    run(
      'bun',
      [
        'x',
        'vitest',
        'run',
        '--config',
        'scripts/integration/settlement.config.mts',
      ],
      { env }
    )
  } finally {
    if (argv.includes('--stop'))
      spawnSync('docker', ['rm', '-f', CONTAINER], { stdio: 'inherit' })
  }
  console.log(`Measurements and events: ${out}`)
}

main(process.argv.slice(2)).catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
