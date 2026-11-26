/**
 * Tests for the v2 chain operations scripts: extend, restore, redeploy,
 * roles (scripts/contracts) and backfill (scripts/chain).
 *
 * - Every script refuses mainnet in every form before it reads a key, a
 *   state file or the network.
 * - Arguments are validated, and every script is a dry run unless
 *   `--submit` is given.
 * - Nothing here talks to a network, runs the Stellar CLI or runs Convex:
 *   RPC is a stubbed `fetch`, and submissions are spied on.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  Account,
  Address,
  Contract,
  Keypair,
  Operation,
  SorobanDataBuilder,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ALLOWED_CONVEX_DEPLOYMENTS,
  LIVE_BACKEND_APPROVAL_ENV,
  LIVE_CONVEX_DEPLOYMENTS,
  NETWORK_GUARD_OPT_IN_ENV,
} from '../../convex/lib/networkGuard'
import { NetworkGuardError } from '../lib/network-guard'
import * as backfill from '../chain/backfill-events'
import * as network from './deploy-v2/network'
import type { DeployState } from './deploy-v2/state'
import * as extend from './extend-v2-testnet'
import * as redeploy from './redeploy-v2-testnet'
import * as restore from './restore-v2-testnet'
import * as roles from './roles-v2-testnet'
import { parseOpsArgs, type OpsContext } from './ops-v2/common'
import {
  classify,
  codeEntry,
  describeKey,
  entriesFromFile,
  entriesFromFootprint,
  footprintKeys,
  instanceEntry,
  ledgerOfCursor,
} from './ops-v2/ledger'
import { KEYS_PER_TX, extendLedgers, planTransactions } from './ops-v2/ttl'

const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015'
const MAINNET_PASSPHRASE = 'Public Global Stellar Network ; September 2015'
const LOCAL_PASSPHRASE = 'Standalone Network ; February 2017'

const TESTNET_ENV = {
  [NETWORK_GUARD_OPT_IN_ENV]: 'testnet',
  NEXT_PUBLIC_STELLAR_NETWORK: 'TESTNET',
  NEXT_PUBLIC_SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
  NEXT_PUBLIC_NETWORK_PASSPHRASE: TESTNET_PASSPHRASE,
}

const LOCAL_ENV = {
  [NETWORK_GUARD_OPT_IN_ENV]: 'local',
  NEXT_PUBLIC_STELLAR_NETWORK: 'LOCAL',
  NEXT_PUBLIC_SOROBAN_RPC_URL: 'http://localhost:8000/rpc',
  NEXT_PUBLIC_HORIZON_URL: 'http://localhost:8000',
  NEXT_PUBLIC_NETWORK_PASSPHRASE: LOCAL_PASSPHRASE,
}

const INTEGRATION = ALLOWED_CONVEX_DEPLOYMENTS[0]!
const LIVE = LIVE_CONVEX_DEPLOYMENTS[0]!
const CONVEX_TESTNET_ENV = {
  ...TESTNET_ENV,
  CONVEX_DEPLOYMENT: `dev:${INTEGRATION}`,
  NEXT_PUBLIC_CONVEX_URL: `https://${INTEGRATION}.convex.cloud`,
}

/** Mainnet in every form the guard must catch. */
const MAINNET_VARIANTS: Record<string, Record<string, string | undefined>> = {
  'network name PUBLIC': { NEXT_PUBLIC_STELLAR_NETWORK: 'PUBLIC' },
  'network name MAINNET in the second variable': { STELLAR_NETWORK: 'MAINNET' },
  'mainnet passphrase': { NEXT_PUBLIC_NETWORK_PASSPHRASE: MAINNET_PASSPHRASE },
  'mainnet passphrase in another case, second variable': {
    NETWORK_PASSPHRASE: MAINNET_PASSPHRASE.toUpperCase(),
  },
  'mainnet RPC host in STELLAR_RPC_URL': {
    STELLAR_RPC_URL: 'https://mainnet.sorobanrpc.com',
  },
  'mainnet Horizon host': {
    NEXT_PUBLIC_HORIZON_URL: 'https://horizon.stellar.org',
  },
  'unlisted RPC host': {
    NEXT_PUBLIC_SOROBAN_RPC_URL: 'https://rpc.example.com',
  },
  'no opt-in': { [NETWORK_GUARD_OPT_IN_ENV]: undefined },
  'LOCAL opt-in with testnet values': { [NETWORK_GUARD_OPT_IN_ENV]: 'local' },
}

const CONTRACT_IDS = {
  core: 'CA2LAU4IZP2PJDBFYB2PMGUQVTWZPIMTZ3ENIIHFGCFM5UR64ZYRJWWK',
  tab: 'CD5DMJCQAITCBWB3HHVDNNDYOD7WNLJCANCOXRBUKFGJZMRLKOHYDBK2',
  nft: 'CAVBR4RL4QRTVZF3SISQCPF3IUK2HAQ7L6UKOUBJGA4DAWUOWJX2WHOV',
}
const NATIVE_SAC = 'CDMLFMKMMD7MWZP3FKUBZPVHTUEDLSX4BYGYKH4GCESXYHS3IHQ4EIG4'
const WASM = {
  core: '32094bceaafb9dfbb5a26767517989baec932a6a38c3e054fb62c4ed3701c7cc',
  tab: 'ef11847d42ed950949fa97c1c6722fa68c107d5fdd4757d35aecf24a2367b9f3',
  nft: '42ef93fc23eace86a9a46efbc1705b8c8471f87cbab6c7837b1907fcb74033c3',
}
/** CONFIG_SETTING_STATE_ARCHIVAL as a Quickstart local network returns it. */
const ARCHIVAL_XDR =
  'AAAACAAAAAoAL3YAAAAC0AAB2IAAAAAAAAAEvwAAAAAAAAl+AAAD6AAAAB4AAABAAAehIAAAAAc='
const ARCHIVAL_KEY = 'AAAACAAAAAo='

type Script = {
  name: string
  main: (
    argv: string[],
    env: Record<string, string | undefined>
  ) => Promise<number>
  argv: string[]
}

const KEYS_DIR = join(tmpdir(), 'qt-ops-never-created')
const STELLAR_ONLY: Script[] = [
  {
    name: 'extend',
    main: extend.main,
    argv: ['--set', 'integration', '--keys-dir', KEYS_DIR],
  },
  {
    name: 'restore',
    main: restore.main,
    argv: ['--set', 'integration', '--keys-dir', KEYS_DIR],
  },
  {
    name: 'redeploy',
    main: redeploy.main,
    argv: ['--set', 'integration', '--keys-dir', KEYS_DIR],
  },
  {
    name: 'roles',
    main: roles.main,
    argv: ['--set', 'integration', '--keys-dir', KEYS_DIR],
  },
]

function codesOf(error: unknown): string[] {
  if (error instanceof NetworkGuardError) return error.codes
  throw error
}

describe('mainnet is refused before any work', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })
  afterEach(() => vi.restoreAllMocks())

  for (const script of STELLAR_ONLY) {
    for (const [label, change] of Object.entries(MAINNET_VARIANTS)) {
      it(`${script.name}: ${label}`, async () => {
        const error = await script
          .main(script.argv, { ...TESTNET_ENV, ...change })
          .catch((e: unknown) => e)
        expect(error).toBeInstanceOf(NetworkGuardError)
        expect(codesOf(error).length).toBeGreaterThan(0)
        expect(fetchSpy).not.toHaveBeenCalled()
      })
    }

    it(`${script.name}: refuses a Convex deploy key or a live-backend approval`, async () => {
      for (const extra of [
        { CONVEX_DEPLOY_KEY: `prod:${LIVE}|secret` },
        { CONVEX_DEPLOYMENT_TOKEN: `prod:${LIVE}|secret` },
        { [LIVE_BACKEND_APPROVAL_ENV]: LIVE },
      ]) {
        const error = await script
          .main(script.argv, { ...TESTNET_ENV, ...extra })
          .catch((e: unknown) => e)
        expect(error).toBeInstanceOf(NetworkGuardError)
        expect(String((error as Error).message)).not.toContain('secret')
      }
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it(`${script.name}: runs the guard under its own operation name`, async () => {
      const error = (await script
        .main(script.argv, {
          ...TESTNET_ENV,
          NEXT_PUBLIC_STELLAR_NETWORK: 'PUBLIC',
        })
        .catch((e: unknown) => e)) as Error
      expect(error.message).toContain(`${script.name}-v2-testnet`)
    })
  }

  const backfillArgv = [
    '--set',
    'integration',
    '--keys-dir',
    KEYS_DIR,
    '--from-ledger',
    '100',
  ]
  for (const [label, change] of Object.entries(MAINNET_VARIANTS)) {
    it(`backfill: ${label}`, async () => {
      const convex = vi.fn()
      const error = await backfill
        .main(backfillArgv, { ...CONVEX_TESTNET_ENV, ...change }, convex)
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(NetworkGuardError)
      expect(convex).not.toHaveBeenCalled()
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  }

  it('backfill: refuses the live deployment without approval, an unlisted one, and none', async () => {
    const convex = vi.fn()
    for (const env of [
      {
        ...TESTNET_ENV,
        CONVEX_DEPLOYMENT: `prod:${LIVE}`,
        NEXT_PUBLIC_CONVEX_URL: `https://${LIVE}.convex.cloud`,
      },
      {
        ...TESTNET_ENV,
        CONVEX_DEPLOYMENT: 'dev:another-deployment-123',
        NEXT_PUBLIC_CONVEX_URL: 'https://another-deployment-123.convex.cloud',
      },
      { ...TESTNET_ENV },
      { ...LOCAL_ENV, CONVEX_DEPLOYMENT: `dev:${INTEGRATION}` },
    ]) {
      const error = await backfill
        .main(backfillArgv, env, convex)
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(NetworkGuardError)
    }
    expect(convex).not.toHaveBeenCalled()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('arguments', () => {
  const base = ['--set', 'integration', '--keys-dir', '/tmp/k']

  it('requires --set integration|live and --keys-dir, and rejects unknown options', () => {
    const spec = { usage: 'usage' }
    expect(() => parseOpsArgs(['--keys-dir', '/k'], spec)).toThrow(/--set/)
    expect(() =>
      parseOpsArgs(['--set', 'mainnet', '--keys-dir', '/k'], spec)
    ).toThrow(/--set/)
    expect(() => parseOpsArgs(['--set', 'live'], spec)).toThrow(/--keys-dir/)
    expect(() => parseOpsArgs([...base, '--network', 'mainnet'], spec)).toThrow(
      /Unknown option/
    )
    expect(() => parseOpsArgs([...base, '--submit=yes'], spec)).toThrow(
      /takes no value/
    )
    expect(() => parseOpsArgs([...base, '--state-file'], spec)).toThrow(
      /needs a value/
    )
    expect(() => parseOpsArgs([...base, 'stray'], spec)).toThrow(/Unexpected/)
  })

  it('is a dry run unless --submit is given', () => {
    expect(extend.parseArgs(base).submit).toBe(false)
    expect(restore.parseArgs(base).submit).toBe(false)
    expect(redeploy.parseArgs(base).submit).toBe(false)
    expect(roles.parseArgs(base).submit).toBe(false)
    expect(backfill.parseArgs([...base, '--from-ledger', '5']).submit).toBe(
      false
    )
    expect(extend.parseArgs([...base, '--submit']).submit).toBe(true)
  })

  it('validates the extend and restore options', () => {
    expect(
      extend
        .parseArgs([...base, '--threshold-days', '3'])
        .values.get('threshold-days')
    ).toBe('3')
    expect(() => extend.parseArgs([...base, '--extend-to', '3'])).toThrow(
      /Unknown option/
    )
    expect(() => restore.parseArgs([...base, '--all'])).toThrow(
      /Unknown option/
    )
  })

  it('validates the roles options', () => {
    const g = Keypair.random().publicKey()
    expect(roles.parseArgs(base).action).toBeUndefined()
    expect(
      roles.parseArgs([...base, '--action', 'pause', '--contracts', 'core,tab'])
        .contracts
    ).toEqual(['core', 'tab'])
    expect(() => roles.parseArgs([...base, '--action', 'upgrade'])).toThrow(
      /--action/
    )
    expect(() =>
      roles.parseArgs([...base, '--action', 'grant', '--role', 'settler'])
    ).toThrow(/--account/)
    expect(() =>
      roles.parseArgs([
        ...base,
        '--action',
        'grant',
        '--role',
        'manager',
        '--account',
        g,
      ])
    ).toThrow(/--role/)
    expect(() =>
      roles.parseArgs([...base, '--action', 'pause', '--role', 'settler'])
    ).toThrow(/grant and revoke only/)
    expect(() => roles.parseArgs([...base, '--submit'])).toThrow(
      /--submit needs an --action/
    )
    expect(() =>
      roles.parseArgs([
        ...base,
        '--action',
        'pause',
        '--contracts',
        'core,vault',
      ])
    ).toThrow(/Unknown contract/)
  })

  it('validates the backfill options', () => {
    expect(() => backfill.parseArgs(base)).toThrow(/--from-ledger is required/)
    expect(() => backfill.parseArgs([...base, '--from-ledger', '0'])).toThrow(
      /positive/
    )
    expect(() =>
      backfill.parseArgs([...base, '--from-ledger', '10', '--to-ledger', '9'])
    ).toThrow(/before/)
    expect(() =>
      backfill.parseArgs([...base, '--from-ledger', '10', '--chunk', '251'])
    ).toThrow(/--chunk/)
    expect(() =>
      backfill.parseArgs([...base, '--from-ledger', '10', '--resume'])
    ).toThrow(/--resume needs --submit/)
    expect(
      backfill.parseArgs([
        ...base,
        '--from-ledger',
        '10',
        '--submit',
        '--resume',
      ]).resume
    ).toBe(true)
  })
})

// ------------------------------------------------------------ dry run vs submit

type RpcHandler = (method: string, params: Record<string, unknown>) => unknown

function stubRpc(handler: RpcHandler) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (_url, init) => {
      const body = JSON.parse(String((init as RequestInit).body)) as {
        method: string
        params: Record<string, unknown>
      }
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: handler(body.method, body.params),
        })
      )
    })
}

function localState(): DeployState {
  return {
    version: 1,
    set: 'integration',
    network: 'LOCAL',
    passphrase: LOCAL_PASSPHRASE,
    commit: '78cd8ff8ba8e44bc91d94a86983e9725ded5ffd0',
    nativeSac: NATIVE_SAC,
    build: {
      commit: '78cd8ff8ba8e44bc91d94a86983e9725ded5ffd0',
      outDir: join(tmpdir(), 'qt-ops-no-build'),
      image: 'image',
      stellarCli: 'cli',
      wasm: {
        core: { sha256: WASM.core, bytes: 1 },
        tab: { sha256: WASM.tab, bytes: 1 },
        nft: { sha256: WASM.nft, bytes: 1 },
      },
      reproduced: true,
    },
    config: { nftBaseUri: 'https://www.quilltip.me/api/nft/' },
    keys: { deployer: Keypair.random().publicKey() },
    uploads: {
      core: { wasmHash: WASM.core, tx: null },
      tab: { wasmHash: WASM.tab, tx: null },
      nft: { wasmHash: WASM.nft, tx: null },
    },
    contracts: {
      core: { id: CONTRACT_IDS.core, salt: 'a', tx: null },
      tab: { id: CONTRACT_IDS.tab, salt: 'b', tx: null },
      nft: { id: CONTRACT_IDS.nft, salt: 'c', tx: null },
    },
  }
}

describe('dry run and submit', () => {
  let keysDir: string
  const coreInstance = new Contract(CONTRACT_IDS.core)
    .getFootprint()
    .toXDR('base64')

  beforeEach(() => {
    keysDir = mkdtempSync(join(tmpdir(), 'qt-ops-test-'))
    mkdirSync(join(keysDir, 'integration'), { recursive: true })
    writeFileSync(
      join(keysDir, 'integration', 'deploy-state.json'),
      JSON.stringify(localState())
    )
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(keysDir, { recursive: true, force: true })
  })

  /** Every tracked entry live until `liveUntil`, the Core instance until `coreUntil`. */
  function network1000(liveUntil: number, coreUntil = liveUntil): RpcHandler {
    return (method, params) => {
      switch (method) {
        case 'getHealth':
          return { status: 'healthy', latestLedger: 1000, oldestLedger: 1 }
        case 'getEvents':
          return { events: [], latestLedger: 1000 }
        case 'getLedgerEntries': {
          const keys = params.keys as string[]
          if (keys[0] === ARCHIVAL_KEY)
            return {
              latestLedger: 1000,
              entries: [{ key: ARCHIVAL_KEY, xdr: ARCHIVAL_XDR }],
            }
          return {
            latestLedger: 1000,
            entries: keys.map((key) => ({
              key,
              xdr: '',
              liveUntilLedgerSeq: key === coreInstance ? coreUntil : liveUntil,
            })),
          }
        }
        default:
          throw new Error(`unexpected RPC ${method}`)
      }
    }
  }

  const argv = () => ['--set', 'integration', '--keys-dir', keysDir]
  const fakeTx = {
    stdout: '',
    txHash: 'ab'.repeat(32),
    tx: { hash: 'ab'.repeat(32), ledger: 1001, feeCharged: '100' },
  }

  it('extend: the dry run sends nothing; --submit sends one transaction per contract and Wasm', async () => {
    stubRpc(network1000(1100))
    const submit = vi.spyOn(network, 'submit').mockResolvedValue(fakeTx)
    expect(await extend.main(argv(), LOCAL_ENV)).toBe(0)
    expect(submit).not.toHaveBeenCalled()
    const report = JSON.parse(
      readFileSync(join(keysDir, 'integration', 'ttl-report.json'), 'utf8')
    )
    expect(report.rows).toHaveLength(7)
    expect(
      report.rows.every((r: { status: string }) => r.status === 'due')
    ).toBe(true)

    expect(await extend.main([...argv(), '--submit'], LOCAL_ENV)).toBe(0)
    // Three Wasm entries, then one transaction per contract (Core, Tab, NFT, native asset).
    expect(submit).toHaveBeenCalledTimes(7)
    for (const call of submit.mock.calls) {
      const args = call[1]
      expect(args.slice(0, 2)).toEqual(['contract', 'extend'])
      expect(args).toContain('--ledgers-to-extend')
      expect(args).toContain('qt-v2-integration-deployer')
    }
    const log = JSON.parse(
      readFileSync(join(keysDir, 'integration', 'ops-log.json'), 'utf8')
    )
    expect(log).toHaveLength(7)
  })

  it('extend: nothing is sent when every entry is above the threshold', async () => {
    stubRpc(network1000(1000 + 40 * 17_280))
    const submit = vi.spyOn(network, 'submit').mockResolvedValue(fakeTx)
    expect(await extend.main([...argv(), '--submit'], LOCAL_ENV)).toBe(0)
    expect(submit).not.toHaveBeenCalled()
  })

  it('extend: exit code 3 when an entry is archived; restore restores only that entry', async () => {
    stubRpc(network1000(1000 + 40 * 17_280, 0))
    const submit = vi.spyOn(network, 'submit').mockResolvedValue(fakeTx)
    expect(await extend.main(argv(), LOCAL_ENV)).toBe(3)
    expect(await restore.main(argv(), LOCAL_ENV)).toBe(3)
    expect(submit).not.toHaveBeenCalled()

    await restore.main([...argv(), '--submit'], LOCAL_ENV)
    expect(submit).toHaveBeenCalledTimes(1)
    const args = submit.mock.calls[0]![1]
    expect(args.slice(0, 4)).toEqual([
      'contract',
      'restore',
      '--id',
      CONTRACT_IDS.core,
    ])
    expect(args).toContain('AAAAFA==')
  })

  it('redeploy: does nothing while the contracts exist', async () => {
    stubRpc((method, params) => {
      if (method === 'getLatestLedger') return { sequence: 5000 }
      if (method === 'getLedgerEntries')
        return {
          latestLedger: 5000,
          entries: (params.keys as string[]).map((key) => ({ key, xdr: '' })),
        }
      throw new Error(`unexpected RPC ${method}`)
    })
    const deploy = vi.spyOn(network, 'submit')
    expect(await redeploy.main([...argv(), '--submit'], LOCAL_ENV)).toBe(0)
    expect(deploy).not.toHaveBeenCalled()
    // The state is untouched.
    const state = JSON.parse(
      readFileSync(join(keysDir, 'integration', 'deploy-state.json'), 'utf8')
    )
    expect(state.contracts.core.id).toBe(CONTRACT_IDS.core)
  })
})

// ------------------------------------------------------------ pure parts

describe('ledger entries', () => {
  it('classifies live, due, archived and absent entries', () => {
    expect(classify(null, 100, 10)).toEqual({
      status: 'absent',
      remaining: null,
    })
    expect(classify(0, 100, 10).status).toBe('archived')
    expect(classify(99, 100, 10).status).toBe('archived')
    expect(classify(105, 100, 10)).toEqual({ status: 'due', remaining: 5 })
    expect(classify(200, 100, 10)).toEqual({ status: 'ok', remaining: 100 })
  })

  it('caps the extension below the network maximum', () => {
    expect(extendLedgers(120, 3_110_400)).toBe(2_073_600)
    expect(extendLedgers(120, 600)).toBe(599)
  })

  it('reads the ledger of a getEvents cursor', () => {
    expect(
      ledgerOfCursor(
        `${(BigInt(5_938_331) << BigInt(32)).toString()}-0000000001`
      )
    ).toBe(5_938_331)
    expect(ledgerOfCursor('not-a-cursor')).toBeNull()
  })

  it('labels contract storage keys', () => {
    const key = nativeToScVal([
      nativeToScVal('Article', { type: 'symbol' }),
      nativeToScVal(Buffer.alloc(32, 0xab)),
    ])
    expect(describeKey(key)).toBe('Article(ababab…abab)')
  })

  it('finds persistent entries of the set, and native balances held by it, in a footprint', () => {
    const data = (
      contract: string,
      key: xdr.ScVal,
      durability: 'persistent' | 'temporary'
    ) =>
      xdr.LedgerKey.contractData(
        new xdr.LedgerKeyContractData({
          contract: new Address(contract).toScAddress(),
          key,
          durability: (
            xdr.ContractDataDurability as unknown as Record<
              string,
              xdr.ContractDataDurability
            >
          )[durability]!,
        })
      )
    const sym = (s: string) => nativeToScVal(s, { type: 'symbol' })
    const article = nativeToScVal([
      sym('Article'),
      nativeToScVal(Buffer.alloc(32, 1)),
    ])
    const tipRef = nativeToScVal([
      sym('TipRef'),
      nativeToScVal(Buffer.alloc(16, 2)),
    ])
    const tabBalance = nativeToScVal([
      sym('Balance'),
      new Address(CONTRACT_IDS.tab).toScVal(),
    ])
    const userBalance = nativeToScVal([
      sym('Balance'),
      new Address(Keypair.random().publicKey()).toScVal(),
    ])
    const other = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'
    const keys = [
      data(CONTRACT_IDS.core, article, 'persistent'),
      data(CONTRACT_IDS.core, tipRef, 'temporary'),
      new Contract(CONTRACT_IDS.core).getFootprint(),
      data(NATIVE_SAC, tabBalance, 'persistent'),
      data(NATIVE_SAC, userBalance, 'persistent'),
      data(other, article, 'persistent'),
    ]
    const account = new Account(Keypair.random().publicKey(), '1')
    const tx = new TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: TESTNET_PASSPHRASE,
    })
      .addOperation(Operation.extendFootprintTtl({ extendTo: 100 }))
      .setSorobanData(
        new SorobanDataBuilder()
          .setReadOnly(keys.slice(0, 3))
          .setReadWrite(keys.slice(3))
          .build()
      )
      .setTimeout(30)
      .build()
    const found = entriesFromFootprint(
      footprintKeys(tx.toEnvelope().toXDR('base64')),
      CONTRACT_IDS,
      NATIVE_SAC
    )
    expect(found.map((e) => e.label)).toEqual([
      'core Article(010101…0101)',
      `sac Balance(${CONTRACT_IDS.tab.slice(0, 6)}…${CONTRACT_IDS.tab.slice(-4)})`,
    ])
  })

  it('reads extra entries from a file and rejects bad ones', () => {
    const key = nativeToScVal([
      nativeToScVal('Account', { type: 'symbol' }),
      new Address(Keypair.random().publicKey()).toScVal(),
    ]).toXDR('base64')
    const [entry] = entriesFromFile(
      JSON.stringify([{ contract: 'tab', keyXdr: key }]),
      CONTRACT_IDS
    )
    expect(entry!.contractId).toBe(CONTRACT_IDS.tab)
    expect(entry!.source).toBe('file')
    expect(() => entriesFromFile('{}', CONTRACT_IDS)).toThrow(/array/)
    expect(() =>
      entriesFromFile(
        JSON.stringify([{ contract: 'vault', keyXdr: key }]),
        CONTRACT_IDS
      )
    ).toThrow(/core, tab or nft/)
  })
})

describe('transaction plans', () => {
  it('puts each Wasm in its own transaction and at most KEYS_PER_TX keys in the others', () => {
    const data = Array.from({ length: KEYS_PER_TX + 3 }, (_, i) => ({
      ...instanceEntry('core', CONTRACT_IDS.core),
      kind: 'data' as const,
      keyXdr: nativeToScVal(i, { type: 'u32' }).toXDR('base64'),
      ledgerKey: `k${i}`,
    }))
    const plans = planTransactions(
      'extend',
      [codeEntry('core', WASM.core), codeEntry('tab', WASM.tab), ...data],
      2_073_600,
      'qt-v2-integration-deployer'
    )
    expect(plans.map((p) => p.entries.length)).toEqual([1, 1, KEYS_PER_TX, 3])
    expect(plans[0]!.args).toEqual([
      'contract',
      'extend',
      '--wasm-hash',
      WASM.core,
      '--ledgers-to-extend',
      '2073600',
      '--source',
      'qt-v2-integration-deployer',
    ])
    expect(plans[2]!.args.filter((a) => a === '--key-xdr')).toHaveLength(
      KEYS_PER_TX
    )
    expect(plans[2]!.args).toContain('persistent')
  })

  it('builds dry-run commands with explicit testnet flags', () => {
    const net = network.resolveDeployNetwork(TESTNET_ENV, 'extend-v2-testnet')
    const { args } = network.cliCommand(
      { net, configDir: '/keys/integration', env: TESTNET_ENV },
      ['contract', 'extend', '--wasm-hash', WASM.core]
    )
    expect(args).toEqual(
      expect.arrayContaining([
        '--network',
        'testnet',
        '--rpc-url',
        'https://soroban-testnet.stellar.org',
        '--network-passphrase',
        TESTNET_PASSPHRASE,
      ])
    )
  })
})

describe('redeploy reset detection', () => {
  const all = { core: true, tab: true, nft: true }
  const none = { core: false, tab: false, nft: false }
  it('detects a reset from the ledger sequence or from all instances missing', () => {
    expect(redeploy.decideReset(100, 5000, all).reset).toBe(true)
    expect(redeploy.decideReset(6000, 5000, none).reset).toBe(true)
  })
  it('refuses when the contracts exist or only some are gone', () => {
    expect(redeploy.decideReset(6000, 5000, all).reset).toBe(false)
    const partial = redeploy.decideReset(6000, 5000, {
      core: true,
      tab: false,
      nft: true,
    })
    expect(partial.reset).toBe(false)
    expect(partial.reason).toMatch(/partial/)
  })
  it('takes the highest recorded ledger', () => {
    const state = localState()
    state.contracts!.core!.tx = { hash: 'a', ledger: 10, feeCharged: '1' }
    state.smoke = {
      tip: {
        flow: 'tip',
        detail: '',
        tx: { hash: 'b', ledger: 42, feeCharged: '1' },
      },
    }
    expect(redeploy.recordedLedger(state)).toBe(42)
  })
})

describe('roles actions', () => {
  const keys = {
    admin: Keypair.random().publicKey(),
    pauser: Keypair.random().publicKey(),
    upgrader: Keypair.random().publicKey(),
  }
  const o = {
    state: { keys },
    identity: (key: string) => `qt-v2-integration-${key}`,
    log: () => {},
  } as unknown as OpsContext
  const current = (paused: boolean, upgraders = [keys.upgrader]) => [
    {
      contract: 'core' as const,
      id: CONTRACT_IDS.core,
      admin: keys.admin,
      paused,
      roles: { pauser: [keys.pauser], upgrader: upgraders, settler: [] },
    },
  ]

  it('pauses with the pauser and unpauses with the admin, skipping a state already in place', () => {
    const pause = roles.planAction(o, current(false), { action: 'pause' })
    expect(pause[0]!.args).toEqual([
      'contract',
      'invoke',
      '--id',
      CONTRACT_IDS.core,
      '--source',
      'qt-v2-integration-pauser',
      '--',
      'pause',
      '--caller',
      keys.pauser,
    ])
    expect(roles.planAction(o, current(true), { action: 'pause' })).toEqual([])
    const unpause = roles.planAction(o, current(true), { action: 'unpause' })
    expect(unpause[0]!.args).toContain('qt-v2-integration-admin')
    expect(roles.planAction(o, current(false), { action: 'unpause' })).toEqual(
      []
    )
  })

  it('grants upgrader with the upgrader and refuses to revoke the last one', () => {
    const other = Keypair.random().publicKey()
    const grant = roles.planAction(o, current(false), {
      action: 'grant',
      role: 'upgrader',
      account: other,
    })
    expect(grant[0]!.args).toContain('qt-v2-integration-upgrader')
    expect(() =>
      roles.planAction(o, current(false), {
        action: 'revoke',
        role: 'upgrader',
        account: keys.upgrader,
      })
    ).toThrow(/only upgrader/)
    const revoke = roles.planAction(o, current(false, [keys.upgrader, other]), {
      action: 'revoke',
      role: 'upgrader',
      account: other,
    })
    expect(revoke).toHaveLength(1)
  })
})

describe('backfill helpers', () => {
  const event = (over: Partial<backfill.BackfillEvent> = {}) => ({
    type: 'contract',
    ledger: 100,
    ledgerClosedAt: '2026-11-26T00:00:00Z',
    contractId: CONTRACT_IDS.core,
    id: '0000000429496729600-0000000001',
    txHash: 'ab'.repeat(32),
    topic: ['AAAADwAAAAZ0aXBwZWQAAA=='],
    value: 'AAAAAQ==',
    ...over,
  })

  it('keeps only the accepted fields and validates them', () => {
    const out = backfill.toBackfillEvent(
      { ...event(), pagingToken: 'x', extra: 1 },
      0
    )
    expect(Object.keys(out).sort()).toEqual([
      'contractId',
      'id',
      'ledger',
      'ledgerClosedAt',
      'topic',
      'txHash',
      'type',
      'value',
    ])
    expect(() =>
      backfill.toBackfillEvent({ ...event(), ledger: '100' }, 3)
    ).toThrow(/Event 3: ledger/)
    expect(() =>
      backfill.toBackfillEvent({ ...event(), topic: [1] }, 0)
    ).toThrow(/topic/)
  })

  it('selects the set and the range, drops repeats and sorts', () => {
    const { kept, dropped } = backfill.selectEvents(
      [
        event({ ledger: 120, id: 'b' }),
        event({ ledger: 110, id: 'a' }),
        event({ ledger: 110, id: 'a' }),
        event({ ledger: 99, id: 'c' }),
        event({ ledger: 130, id: 'd', contractId: NATIVE_SAC }),
      ],
      Object.values(CONTRACT_IDS),
      100,
      125
    )
    expect(kept.map((e) => e.id)).toEqual(['a', 'b'])
    expect(dropped).toBe(3)
  })

  it('stops with recovery steps when the range is older than RPC retention', () => {
    const text = backfill.retentionInstructions(
      { set: 'integration', fromLedger: 100 },
      900,
      500
    )
    expect(text).toContain('Ledgers 100 to 499')
    expect(text).toContain('CHAIN_V2_ENABLED=false')
    expect(text).toContain('--events-file')
    expect(text).toContain('--from-ledger 500 --submit --resume')
  })

  it('blanks unset Convex targets so .env.local cannot add one', () => {
    const env = backfill.convexRunEnv({
      CONVEX_DEPLOYMENT: `dev:${INTEGRATION}`,
    })
    expect(env.CONVEX_DEPLOYMENT).toBe(`dev:${INTEGRATION}`)
    expect(env.CONVEX_DEPLOY_KEY).toBe('')
    expect(env.CONVEX_DEPLOYMENT_TOKEN).toBe('')
    expect(env.CONVEX_SELF_HOSTED_URL).toBe('')
    expect(() => backfill.convexRunEnv({})).toThrow(NetworkGuardError)
  })
})
