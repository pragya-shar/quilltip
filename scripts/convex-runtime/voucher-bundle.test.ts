/**
 * Runs the Convex voucher code as the Convex default runtime does: bundled by
 * esbuild with `platform: "browser"` (as `convex/dist/cjs/bundler` does) and
 * evaluated where there is no global `Buffer`. The chain tests run in
 * vitest's edge runtime, which has one, so they cannot catch a module that
 * relies on the global.
 */
import { spawnSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { pathToFileURL } from 'url'

import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import shared from '../../contracts/shared/test-vectors.json'

const ROOT = resolve(__dirname, '../..')

const ENTRY = `
import shared from './contracts/shared/test-vectors.json'
import {
  loadAcceptor,
  networkIdOf,
  receiptLeafHex,
  receiptsRootHex,
  verifyEd25519,
  voucherPayloadBytes,
} from './convex/lib/chain/voucher'

const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
const unhex = (h) => new Uint8Array(h.match(/../g).map((x) => parseInt(x, 16)))

export function run() {
  const out = { bufferGlobal: typeof Buffer, error: null, vouchers: [], leaves: [], root: null }
  // verifyEd25519 on its own, over the vector payload bytes.
  out.vectorSignatures = shared.vouchers.map((v) =>
    verifyEd25519(shared.keys.session.public_key, unhex(v.payload_xdr), v.signature)
  )
  try {
    const env = {
      STELLAR_NETWORK: 'TESTNET',
      NETWORK_PASSPHRASE: shared.network.passphrase,
      SETTLEMENT_ENABLED: 'true',
      TAB_ACCEPTOR_SECRET: shared.keys.acceptor.seed,
    }
    const acceptor = loadAcceptor(env)
    const networkId = networkIdOf(shared.network.passphrase)
    const leaves = shared.receipts.items.map((r) =>
      receiptLeafHex({
        amount: r.amount,
        articleId: r.article_id,
        clientRef: r.client_ref,
        contentHash: r.content_hash,
        cumulativeAfter: r.cumulative_after,
        highlightId: r.highlight_id,
        seq: r.seq,
      })
    )
    out.leaves = leaves
    out.root = receiptsRootHex(leaves)
    out.networkId = hex(networkId)
    out.acceptor = acceptor.publicKey
    for (const v of shared.vouchers) {
      const payload = voucherPayloadBytes({
        tab: shared.tab_contract,
        networkId,
        reader: v.reader,
        writer: v.writer,
        keyId: v.key_id,
        publicKey: unhex(shared.keys.session.public_key),
        cumulative: BigInt(v.cumulative),
        receiptsRoot: unhex(out.root),
      })
      const flipped = (parseInt(v.signature.slice(0, 2), 16) ^ 1).toString(16).padStart(2, '0') + v.signature.slice(2)
      out.vouchers.push({
        case: v.case,
        payload: hex(payload),
        valid: verifyEd25519(shared.keys.session.public_key, payload, v.signature),
        tampered: verifyEd25519(shared.keys.session.public_key, payload, flipped),
        acceptance: acceptor.sign(payload),
      })
    }
  } catch (e) {
    out.error = String(e)
  }
  return out
}
`

const RUNNER = `
delete globalThis.Buffer
const mod = await import(process.argv[2])
process.stdout.write(JSON.stringify(mod.run()))
`

type Result = {
  bufferGlobal: string
  vectorSignatures: boolean[]
  error: string | null
  networkId?: string
  acceptor?: string
  leaves: string[]
  root: string | null
  vouchers: {
    case: string
    payload: string
    valid: boolean
    tampered: boolean
    acceptance: string
  }[]
}

let dir: string
let result: Result

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'convex-bundle-'))
  const bundle = join(dir, 'bundle.mjs')
  await build({
    stdin: { contents: ENTRY, resolveDir: ROOT, loader: 'ts' },
    outfile: bundle,
    bundle: true,
    platform: 'browser',
    format: 'esm',
    logLevel: 'silent',
    absWorkingDir: ROOT,
  })
  const runner = join(dir, 'run.mjs')
  writeFileSync(runner, RUNNER)
  const child = spawnSync(
    process.execPath,
    [runner, pathToFileURL(bundle).href],
    { encoding: 'utf8' }
  )
  if (child.status !== 0) throw new Error(child.stderr)
  result = JSON.parse(child.stdout) as Result
}, 60_000)

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('Convex voucher code without a global Buffer', () => {
  it('runs where Buffer is not a global', () => {
    expect(result.bufferGlobal).toBe('undefined')
    expect(result.error).toBeNull()
  })

  it('verifies the vector signatures', () => {
    expect(result.vectorSignatures).toEqual(shared.vouchers.map(() => true))
  })

  it('derives the network id and the acceptor key', () => {
    expect(result.networkId).toBe(shared.network.network_id)
    expect(result.acceptor).toBe(shared.keys.acceptor.public_key)
  })

  it('rebuilds the receipt leaves and root', () => {
    expect(result.leaves).toEqual(shared.receipts.items.map((r) => r.leaf))
    expect(result.root).toBe(shared.receipts.roots.at(-1)!.root)
  })

  it('verifies the voucher signatures and signs the acceptance', () => {
    expect(result.vouchers).toHaveLength(shared.vouchers.length)
    for (const [i, v] of shared.vouchers.entries()) {
      const got = result.vouchers[i]!
      expect(got.case).toBe(v.case)
      expect(got.payload).toBe(v.payload_xdr)
      expect(got.valid).toBe(true)
      expect(got.tampered).toBe(false)
      expect(got.acceptance).toBe(v.acceptance_signature)
    }
  })
})
