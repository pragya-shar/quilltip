import fs from 'fs'
import os from 'os'
import path from 'path'

import { Keypair, StrKey } from '@stellar/stellar-sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  EXTRA_PRODUCTION_DEPLOYMENTS_ENV,
  LIVE_BACKEND_APPROVAL_ENV,
  LIVE_WINDOW_APPROVAL_ENV,
  NETWORK_GUARD_OPT_IN_ENV,
  NetworkGuardError,
} from '../../convex/lib/networkGuard'
import {
  MAINNET_PASSPHRASE,
  TESTNET_PASSPHRASE,
} from '../../lib/stellar/network'
import {
  LIVE_READ_FUNCTIONS,
  LIVE_READ_FUNCTION_NAMES,
  LIVE_READ_OTHER_TARGETS,
  envFilesAssigningOperationalApproval,
  evaluateLiveRead,
  parseLiveReadRequest,
  pruneOtherCaches,
  type LiveReadFacts,
} from '../lib/live-read'
import {
  LIVE_WINDOW_FUNCTION_SHAPES,
  isStellarAccountAddress,
} from '../lib/live-window'
import { assertScriptTestnetOnly } from '../lib/network-guard'
import { runLiveReadCli } from '../live-read'

const LIVE = 'upbeat-mockingbird-579'
const INTEGRATION = 'efficient-tern-39'
const HEAD = '3f2c9a1b7d4e5f60718293a4b5c6d7e8f9012345'
const CHECKOUT = '/work/quilltip'
const DEPLOY_KEY = `dev:${LIVE}|key-material-that-must-not-leak`
const READER = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'
const READER_2 = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7)).publicKey()
const REPO = path.resolve(__dirname, '../..')

const READ_ENV: Record<string, string | undefined> = {
  [NETWORK_GUARD_OPT_IN_ENV]: 'testnet',
  NEXT_PUBLIC_STELLAR_NETWORK: 'TESTNET',
  CONVEX_DEPLOY_KEY: DEPLOY_KEY,
  [LIVE_BACKEND_APPROVAL_ENV]: LIVE,
}

const READ_FACTS: LiveReadFacts = {
  now: new Date('2026-12-20T09:00:00Z'),
  head: HEAD,
  dirty: false,
  checkoutRoot: CHECKOUT,
  cwdRoot: CHECKOUT,
  envFileHits: [],
}

function readCodes(
  args: string[] | null,
  env: Record<string, string | undefined> = {},
  facts: Partial<LiveReadFacts> = {}
): string[] {
  try {
    evaluateLiveRead(args, { ...READ_ENV, ...env }, { ...READ_FACTS, ...facts })
    return []
  } catch (error) {
    if (error instanceof NetworkGuardError) return error.codes
    throw error
  }
}

function readMessage(
  args: string[] | null,
  env: Record<string, string | undefined> = {}
): string {
  try {
    evaluateLiveRead(args, { ...READ_ENV, ...env }, READ_FACTS)
    return ''
  } catch (error) {
    if (error instanceof NetworkGuardError) return error.message
    throw error
  }
}

const tabRun = (json: string) => ['chain/tabReconcile:run', json]

describe('read-only path: every runbook command', () => {
  it.each([
    // Chain runbook, "Stale settlement reserves", step 2 (daily).
    [tabRun(`{"reader":"${READER}"}`), `{"reader":"${READER}"}`],
    [tabRun(`{ "reader" : "${READER_2}" }`), `{"reader":"${READER_2}"}`],
    // Cutover stage 1 and stage 3 check.
    [['chain/config:getChainConfig'], '{}'],
    [['chain/config:getChainConfig', '{}'], '{}'],
    // Cutover stage 5A and section 9.
    [['earningsTotalsBackfill:progress'], '{}'],
    [['earningsTotalsBackfill:progress', ' {} '], '{}'],
    // Cutover stage 1, step 4.
    [['articleImageHosts:countImageHosts'], '{}'],
    [['articleImageHosts:countImageHosts', '{}'], '{}'],
  ])('allows %j', (args, sent) => {
    const decision = evaluateLiveRead(args, READ_ENV, READ_FACTS)
    expect(decision.request?.convexArgs).toEqual(['run', args[0], sent])
    expect(decision.deployment).toBe(LIVE)
    expect(decision.commit).toBe(HEAD)
    expect(decision.guard.liveBackendApproved).toBe(true)
    expect(decision.guard.convexDeployments).toEqual([LIVE])
  })

  it('lists these functions and no other', () => {
    expect(LIVE_READ_FUNCTION_NAMES).toEqual([
      'chain/tabReconcile:run',
      'chain/config:getChainConfig',
      'earningsTotalsBackfill:progress',
      'articleImageHosts:countImageHosts',
    ])
  })

  it('checks the approval alone without an operation', () => {
    const decision = evaluateLiveRead(null, READ_ENV, READ_FACTS)
    expect(decision.request).toBeNull()
  })
})

describe('read-only path: near misses', () => {
  it.each([
    // Extra keys, and every way to ask for a write.
    tabRun(`{"reader":"${READER}","keyId":1}`),
    tabRun(`{"reader":"${READER}","writer":"${READER_2}"}`),
    tabRun(`{"reader":"${READER}","apply":true}`),
    tabRun(`{"reader":"${READER}","apply":false}`),
    tabRun(`{"reader":"${READER}","apply":"true"}`),
    tabRun(`{"reader":"${READER}","apply":true,"note":"ticket 1"}`),
    tabRun(`{"reader":"${READER}","note":"ticket 1"}`),
    tabRun(`{"reader":"${READER}","__proto__":{"apply":true}}`),
    tabRun(`{"reader":"${READER}","constructor":{}}`),
    tabRun(`{"reader":"${READER}","Apply":true}`),
    tabRun(`{"reader":"${READER}","apply ":true}`),
    ['chain/config:getChainConfig', '{"apply":true}'],
    ['earningsTotalsBackfill:progress', '{"cursor":null}'],
    ['articleImageHosts:countImageHosts', '{"cursor":null}'],
    // Missing or malformed arguments.
    ['chain/tabReconcile:run'],
    tabRun('{}'),
    tabRun(`["${READER}"]`),
    tabRun(`"${READER}"`),
    tabRun('null'),
    tabRun('true'),
    tabRun(`{"reader":"${READER}"`),
    tabRun(`{"reader":"${READER}"} extra`),
    ['chain/tabReconcile:run', `{"reader":"${READER}"}`, '--prod'],
    ['chain/tabReconcile:run', `{"reader":"${READER}"}`, '--push'],
    [],
  ])('refuses %j', (...args) => {
    expect(readCodes(args)).toEqual(['LIVE_READ_OPERATION'])
  })

  it.each([
    READER.toLowerCase(),
    `${READER} `,
    ` ${READER}`,
    READER.slice(0, 55),
    `${READER}A`,
    // One character changed: the checksum no longer matches.
    `${READER.slice(0, 54)}XF`,
    `${READER_2.slice(0, 10)}${READER_2[10] === 'A' ? 'B' : 'A'}${READER_2.slice(11)}`,
    // Other key types.
    StrKey.encodeMed25519PublicKey(Buffer.alloc(40, 1)),
    StrKey.encodeContract(Buffer.alloc(32, 1)),
    Keypair.fromRawEd25519Seed(Buffer.alloc(32, 7)).secret(),
    // Look-alikes.
    `Ｇ${READER.slice(1)}`,
    `${READER.slice(0, 20)}​${READER.slice(20)}`,
    '',
  ])('refuses the reader %j', (reader) => {
    expect(readCodes(tabRun(JSON.stringify({ reader })))).toEqual([
      'LIVE_READ_OPERATION',
    ])
  })

  it.each([[42], [null], [[READER]], [{ address: READER }], [true]])(
    'refuses the reader value %j',
    (reader) => {
      expect(readCodes(tabRun(JSON.stringify({ reader })))).toEqual([
        'LIVE_READ_OPERATION',
      ])
    }
  )

  it.each([
    'chain/tabReconcile:Run',
    'chain/tabReconcile:run ',
    ' chain/tabReconcile:run',
    'chain/tabreconcile:run',
    'chain/tabReconcile.run',
    'chain/tabReconcile:run.js',
    './chain/tabReconcile:run',
    'chain\\tabReconcile:run',
    'chain/tabReconcile:​run',
    'tabReconcile:run',
    'chain/tabReconcile',
    // Functions the listed ones call, and their neighbours.
    'chain/tabReconcile:reconcile',
    'chain/tabReconcile:snapshot',
    'chain/tabReconcile:listStaleReserves',
    'chain/config:refreshChainConfig',
    'earningsTotalsBackfill:dryRun',
    'earningsTotalsBackfill:reset',
    'articleImageHosts:imageHostPage',
    'chain/tabClaims:recomputeCollected',
    'reconcileTips:recoverStuckPendingArticleTips',
    // Names that exist on every object.
    '__proto__',
    'constructor',
    'hasOwnProperty',
    'toString',
  ])('refuses the function %j', (fn) => {
    expect(readCodes([fn, `{"reader":"${READER}"}`])).toEqual([
      'LIVE_READ_OPERATION',
    ])
    expect(readCodes([fn])).toEqual(['LIVE_READ_OPERATION'])
  })

  it('never echoes a refused value', () => {
    const message = readMessage(tabRun('{"reader":"S-secret-like-value"}'))
    expect(message).toContain('LIVE_READ_OPERATION')
    expect(message).not.toContain('S-secret-like-value')
    expect(readMessage(tabRun('{"x-secret-name":1}'))).not.toContain(
      'x-secret-name'
    )
  })

  it('rebuilds the arguments it sends from the checked values', () => {
    const parsed = parseLiveReadRequest(
      tabRun(`{"reader":"${READER_2}","reader":"${READER}"}`)
    )
    // Duplicate keys: JSON keeps the last one, and that value is checked and
    // sent; nothing unchecked can reach the CLI.
    expect('request' in parsed && parsed.request.convexArgs).toEqual([
      'run',
      'chain/tabReconcile:run',
      `{"reader":"${READER}"}`,
    ])
    const escaped = parseLiveReadRequest(tabRun(`{"re\\u0061der":"${READER}"}`))
    expect('request' in escaped && escaped.request.argsJson).toBe(
      `{"reader":"${READER}"}`
    )
  })
})

describe('read-only path: approvals, targets and network', () => {
  it('refuses without the operational approval, as the shared guard does', () => {
    expect(
      readCodes(tabRun(`{"reader":"${READER}"}`), {
        [LIVE_BACKEND_APPROVAL_ENV]: undefined,
      })
    ).toEqual(['LIVE_BACKEND_NOT_APPROVED', 'LIVE_READ_INVALID'])
    expect(readCodes(null, { [LIVE_BACKEND_APPROVAL_ENV]: '' })).toEqual([
      'LIVE_BACKEND_NOT_APPROVED',
      'LIVE_READ_INVALID',
    ])
  })

  it('refuses while the window approval is set, with or without the operational one', () => {
    const window = `${LIVE}@${HEAD}@2026-12-20T08:00Z+3h`
    expect(
      readCodes(tabRun(`{"reader":"${READER}"}`), {
        [LIVE_WINDOW_APPROVAL_ENV]: window,
      })
    ).toEqual(['LIVE_WINDOW_NOT_FOR_TOOL'])
    expect(
      readCodes(tabRun(`{"reader":"${READER}"}`), {
        [LIVE_WINDOW_APPROVAL_ENV]: window,
        [LIVE_BACKEND_APPROVAL_ENV]: undefined,
      })
    ).toEqual([
      'LIVE_BACKEND_NOT_APPROVED',
      'LIVE_WINDOW_NOT_FOR_TOOL',
      'LIVE_READ_INVALID',
    ])
  })

  it.each([
    [{ [LIVE_BACKEND_APPROVAL_ENV]: INTEGRATION }],
    [
      {
        [LIVE_BACKEND_APPROVAL_ENV]: INTEGRATION,
        CONVEX_DEPLOY_KEY: `dev:${INTEGRATION}|key`,
      },
    ],
    [{ CONVEX_DEPLOY_KEY: `dev:${INTEGRATION}|key` }],
    [{ NEXT_PUBLIC_CONVEX_URL: `https://${INTEGRATION}.convex.cloud` }],
    [{ CONVEX_URL: `https://${INTEGRATION}.convex.cloud` }],
    // The live URL first, then a second target: still two targets.
    [
      {
        NEXT_PUBLIC_CONVEX_URL: `https://${LIVE}.convex.cloud`,
        CONVEX_URL: `https://${INTEGRATION}.convex.cloud`,
      },
    ],
  ])('refuses the integration deployment: %j', (env) => {
    const codes = readCodes(tabRun(`{"reader":"${READER}"}`), env)
    expect(codes.length).toBeGreaterThan(0)
    expect(
      codes.some((c) =>
        [
          'LIVE_READ_INVALID',
          'LIVE_READ_CREDENTIAL',
          'LIVE_READ_OTHER_TARGET',
          'INVALID_APPROVAL',
        ].includes(c)
      )
    ).toBe(true)
  })

  it('accepts only the exact live name as the approval', () => {
    for (const value of [
      'UPBEAT-MOCKINGBIRD-579',
      ` ${LIVE}`,
      `${LIVE} `,
      `${LIVE},${LIVE}`,
      `dev:${LIVE}`,
      'quiet-test-123',
    ]) {
      expect(readCodes(null, { [LIVE_BACKEND_APPROVAL_ENV]: value })).toContain(
        'LIVE_READ_INVALID'
      )
    }
    // The extra production list adds protection; it never opens a target.
    expect(
      readCodes(null, {
        [EXTRA_PRODUCTION_DEPLOYMENTS_ENV]: 'quiet-test-123',
        [LIVE_BACKEND_APPROVAL_ENV]: 'quiet-test-123',
        CONVEX_DEPLOY_KEY: 'dev:quiet-test-123|key',
      })
    ).toEqual(['LIVE_READ_INVALID'])
  })

  it('needs a development deploy key for the live deployment', () => {
    expect(readCodes(null, { CONVEX_DEPLOY_KEY: undefined })).toEqual([
      'UNKNOWN_CONVEX',
      'LIVE_READ_CREDENTIAL',
    ])
    expect(readCodes(null, { CONVEX_DEPLOY_KEY: `prod:${LIVE}|key` })).toEqual([
      'LIVE_READ_CREDENTIAL',
    ])
    expect(
      readCodes(null, { CONVEX_DEPLOY_KEY: `preview:${LIVE}|key` })
    ).toEqual(['LIVE_READ_CREDENTIAL'])
    expect(readCodes(null, { CONVEX_DEPLOY_KEY: 'bare-key-material' })).toEqual(
      ['CONVEX_NOT_ALLOWLISTED', 'UNKNOWN_CONVEX']
    )
    expect(
      readMessage(null, { CONVEX_DEPLOY_KEY: `prod:${LIVE}|secret-x` })
    ).not.toContain('secret-x')
  })

  it.each([...LIVE_READ_OTHER_TARGETS])(
    'refuses another CLI target variable: %s',
    (name) => {
      expect(readCodes(null, { [name]: `dev:${LIVE}` })).toContain(
        'LIVE_READ_OTHER_TARGET'
      )
    }
  )

  it.each(['NODE_OPTIONS', 'NODE_PATH', 'BUN_OPTIONS'])(
    'refuses %s',
    (name) => {
      expect(readCodes(null, { [name]: '--require /tmp/x.js' })).toEqual([
        'LIVE_READ_CHECKOUT',
      ])
    }
  )

  it.each([
    [{ NEXT_PUBLIC_STELLAR_NETWORK: 'PUBLIC' }],
    [{ NEXT_PUBLIC_STELLAR_NETWORK: 'MAINNET' }],
    [{ STELLAR_NETWORK: 'MAINNET' }],
    [{ NETWORK_PASSPHRASE: MAINNET_PASSPHRASE }],
    [
      {
        NEXT_PUBLIC_NETWORK_PASSPHRASE: ` ${MAINNET_PASSPHRASE.toLowerCase()} `,
      },
    ],
    [{ HORIZON_URL: 'https://horizon.stellar.org' }],
    [{ STELLAR_RPC_URL: 'https://mainnet.sorobanrpc.com' }],
    [
      {
        NEXT_PUBLIC_STELLAR_RPC_URL:
          'https://soroban-rpc.mainnet.stellar.gateway.fm',
      },
    ],
  ])('refuses mainnet values: %j', (env) => {
    const codes = readCodes(tabRun(`{"reader":"${READER}"}`), env)
    expect(codes.length).toBeGreaterThan(0)
    expect(
      codes.every((c) =>
        [
          'NOT_TESTNET',
          'CONFLICTING_NETWORK',
          'MAINNET_PASSPHRASE',
          'MAINNET_URL',
          'LIVE_READ_OTHER_TARGET',
        ].includes(c)
      )
    ).toBe(true)
  })

  it('accepts the testnet passphrase and endpoints', () => {
    expect(
      readCodes(tabRun(`{"reader":"${READER}"}`), {
        NETWORK_PASSPHRASE: TESTNET_PASSPHRASE,
        STELLAR_RPC_URL: 'https://soroban-testnet.stellar.org',
        HORIZON_URL: 'https://horizon-testnet.stellar.org',
        NEXT_PUBLIC_CONVEX_URL: `https://${LIVE}.convex.cloud`,
      })
    ).toEqual([])
  })

  it('needs the opt-in', () => {
    expect(readCodes(null, { [NETWORK_GUARD_OPT_IN_ENV]: undefined })).toEqual([
      'MISSING_OPT_IN',
    ])
  })

  it('refuses a dirty checkout, another folder and an approval in a file', () => {
    expect(
      readCodes(null, {}, { dirty: true, dirtyPaths: ['convex/x.ts'] })
    ).toEqual(['LIVE_READ_CHECKOUT'])
    expect(readCodes(null, {}, { dirty: null })).toEqual(['LIVE_READ_CHECKOUT'])
    expect(readCodes(null, {}, { cwdRoot: '/elsewhere' })).toEqual([
      'LIVE_READ_CHECKOUT',
    ])
    expect(readCodes(null, {}, { head: null })).toEqual(['LIVE_READ_CHECKOUT'])
    expect(
      readCodes(null, {}, { envFileHits: ['/work/quilltip/.env.local'] })
    ).toEqual(['LIVE_READ_IN_FILE'])
  })
})

describe('read-only path: no approval behaves as before', () => {
  it('leaves the shared operational guard unchanged on the live target', () => {
    const env = { ...READ_ENV, [LIVE_BACKEND_APPROVAL_ENV]: undefined }
    expect(() => assertScriptTestnetOnly('script', env)).toThrow(
      /LIVE_BACKEND_NOT_APPROVED/
    )
    // With the approval, the shared guard alone allows the live target: the
    // closed list is what limits this tool to reads.
    expect(assertScriptTestnetOnly('script', READ_ENV)).toEqual({
      network: 'TESTNET',
      convexDeployments: [LIVE],
      liveBackendApproved: true,
    })
  })
})

describe('read-only CLI', () => {
  afterEach(() => vi.restoreAllMocks())

  function cli(
    argv: string[],
    options: {
      env?: Record<string, string | undefined>
      facts?: (call: number) => Partial<LiveReadFacts>
      buildFails?: boolean
      logFails?: boolean
    } = {}
  ) {
    const spawned: string[][] = []
    const built: string[] = []
    const logged: Record<string, unknown>[] = []
    const out: string[] = []
    let calls = 0
    for (const method of ['log', 'warn', 'error'] as const) {
      vi.spyOn(console, method).mockImplementation((...args) => {
        out.push(args.map(String).join(' '))
      })
    }
    const code = runLiveReadCli(
      argv,
      { ...READ_ENV, ...options.env },
      {
        facts: () => ({ ...READ_FACTS, ...options.facts?.(calls++) }),
        build: (commit) => {
          built.push(`build ${commit}`)
          if (options.buildFails) {
            throw new NetworkGuardError('live window build', [
              { code: 'LIVE_WINDOW_BUILD', message: 'cannot build' },
            ])
          }
          return { tree: 'f'.repeat(40) }
        },
        close: () => {
          built.push('close')
        },
        spawn: (args) => {
          spawned.push(args)
          return { status: 0 }
        },
        log: (entry) => {
          if (options.logFails) {
            throw new NetworkGuardError('live window log', [
              { code: 'LIVE_WINDOW_LOG', message: 'cannot write' },
            ])
          }
          logged.push(entry)
        },
      }
    )
    return { code, spawned, built, logged, out: out.join('\n') }
  }

  it('check is a dry mode: no build, no Convex call, one log line', () => {
    const result = cli(['check'])
    expect(result.code).toBe(0)
    expect(result.spawned).toEqual([])
    expect(result.built).toEqual([])
    expect(result.out).toContain('Dry mode')
    expect(result.out).toContain('chain/tabReconcile:run {"reader"}')
    expect(result.logged).toEqual([
      {
        event: 'check',
        operation: 'read check',
        deployment: LIVE,
        commit: HEAD,
      },
    ])
    const one = cli(['check', ...tabRun(`{"reader":"${READER}"}`)])
    expect(one.code).toBe(0)
    expect(one.spawned).toEqual([])
    expect(one.built).toEqual([])
  })

  it('run builds from HEAD once and runs exactly the checked command', () => {
    const result = cli(['run', ...tabRun(`{ "reader": "${READER}" }`)])
    expect(result.code).toBe(0)
    expect(result.built).toEqual([`build ${HEAD}`, 'close'])
    expect(result.spawned).toEqual([
      ['run', 'chain/tabReconcile:run', `{"reader":"${READER}"}`],
    ])
    expect(result.logged.map((e) => e.event)).toEqual([
      'allowed',
      'built',
      'finished',
    ])
    expect(result.out).toContain('READ-ONLY OPERATION')
    expect(JSON.stringify(result.logged)).not.toContain('key-material')
    expect(result.out).not.toContain('key-material')
  })

  it('runs nothing when refused, and logs no argument value', () => {
    const result = cli([
      'run',
      ...tabRun(`{"reader":"${READER}","apply":true,"note":"n"}`),
    ])
    expect(result.code).toBe(1)
    expect(result.built).toEqual([])
    expect(result.spawned).toEqual([])
    expect(result.logged).toEqual([
      {
        event: 'refused',
        operation: 'read chain/tabReconcile:run',
        codes: ['LIVE_READ_OPERATION'],
      },
    ])
    const unknown = cli(['run', 'chain/tabReconcile:reconcile', '{}'])
    expect(unknown.logged[0]?.operation).toBe('read <function>')
  })

  it('runs nothing when the build fails', () => {
    const result = cli(['run', 'chain/config:getChainConfig'], {
      buildFails: true,
    })
    expect(result.code).toBe(1)
    expect(result.spawned).toEqual([])
    expect(result.built).toEqual([`build ${HEAD}`, 'close'])
    expect(result.out).toContain('Nothing was run.')
  })

  it('runs nothing when HEAD or the checkout changes during the build', () => {
    const moved = cli(['run', 'chain/config:getChainConfig'], {
      facts: (call) => (call >= 1 ? { head: 'b'.repeat(40) } : {}),
    })
    expect(moved.code).toBe(1)
    expect(moved.spawned).toEqual([])
    expect(moved.built).toEqual([`build ${HEAD}`, 'close'])
    const dirty = cli(['run', 'chain/config:getChainConfig'], {
      facts: (call) => (call >= 1 ? { dirty: true } : {}),
    })
    expect(dirty.code).toBe(1)
    expect(dirty.spawned).toEqual([])
  })

  it('runs nothing when the log cannot be written', () => {
    const result = cli(['run', 'chain/config:getChainConfig'], {
      logFails: true,
    })
    expect(result.code).toBe(1)
    expect(result.built).toEqual([])
    expect(result.spawned).toEqual([])
  })

  it('prints usage for anything else', () => {
    expect(cli([]).code).toBe(2)
    expect(cli(['run']).code).toBe(2)
    expect(cli(['exec', 'chain/config:getChainConfig']).code).toBe(2)
  })
})

describe('read-only path: helpers', () => {
  it('decodes account addresses as the Stellar SDK does', () => {
    for (let i = 0; i < 200; i++) {
      const address = Keypair.random().publicKey()
      expect(isStellarAccountAddress(address)).toBe(true)
      const index = 1 + (i % 55)
      const other = address[index] === 'A' ? 'B' : 'A'
      const changed = `${address.slice(0, index)}${other}${address.slice(index + 1)}`
      expect(isStellarAccountAddress(changed)).toBe(
        StrKey.isValidEd25519PublicKey(changed)
      )
    }
    expect(isStellarAccountAddress(READER)).toBe(true)
  })

  it('refuses a G address whose version byte is not the account version', () => {
    // A valid checksum over version byte 0x31..0x37 still starts with G.
    const base32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
    const encode = (bytes: number[]) => {
      let out = ''
      let buffer = 0
      let bits = 0
      for (const byte of bytes) {
        buffer = (buffer << 8) | byte
        bits += 8
        while (bits >= 5) {
          bits -= 5
          out += base32[(buffer >> bits) & 31]
        }
      }
      return out
    }
    const crc = (bytes: number[]) => {
      let c = 0
      for (const byte of bytes) {
        c ^= byte << 8
        for (let i = 0; i < 8; i++) {
          c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff
        }
      }
      return c
    }
    for (const version of [0x30, 0x31, 0x37]) {
      const body = [version, ...new Array<number>(32).fill(9)]
      const sum = crc(body)
      const address = encode([...body, sum & 0xff, sum >> 8])
      expect(address[0]).toBe('G')
      expect(isStellarAccountAddress(address)).toBe(version === 0x30)
      expect(StrKey.isValidEd25519PublicKey(address)).toBe(version === 0x30)
    }
  })

  it('finds the operational approval in .env files only', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-read-env-'))
    try {
      fs.writeFileSync(
        path.join(dir, '.env.local'),
        `X=1\nexport ${LIVE_BACKEND_APPROVAL_ENV}=${LIVE}\n`
      )
      fs.writeFileSync(
        path.join(dir, '.env'),
        `# ${LIVE_BACKEND_APPROVAL_ENV} is set per shell\n`
      )
      fs.writeFileSync(
        path.join(dir, 'notes.txt'),
        `${LIVE_BACKEND_APPROVAL_ENV}=${LIVE}\n`
      )
      expect(envFilesAssigningOperationalApproval([dir, dir])).toEqual([
        path.join(fs.realpathSync(dir), '.env.local'),
      ])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('prunes the package caches of other commits only', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live-read-root-'))
    try {
      for (const name of [
        `cache-${HEAD}`,
        `cache-${'a'.repeat(40)}`,
        'run-x',
        'cache-other',
      ]) {
        fs.mkdirSync(path.join(root, name))
      }
      pruneOtherCaches(root, HEAD)
      expect(fs.readdirSync(root).sort()).toEqual(
        ['cache-other', `cache-${HEAD}`, 'run-x'].sort()
      )
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})

/** The source of `export const <name> = <type>({ … })` in a Convex module. */
function convexExport(fn: string): {
  type: string
  body: string
  args: string[]
} {
  const [module, name] = fn.split(':') as [string, string]
  const source = fs.readFileSync(
    path.join(REPO, 'convex', `${module}.ts`),
    'utf8'
  )
  const start = source.search(
    new RegExp(`^export const ${name} = (\\w+)\\(\\{`, 'm')
  )
  if (start < 0) throw new Error(`${fn} is not exported`)
  const type = /= (\w+)\(/.exec(source.slice(start))?.[1] ?? ''
  const end = source.indexOf('\n})\n', start)
  const body = source.slice(start, end < 0 ? undefined : end + 3)
  const argsBlock =
    /\n {2}args: \{([\s\S]*?)\n {2}\},?\n|\n {2}args: \{\},?\n/.exec(body)
  const args = [...(argsBlock?.[1] ?? '').matchAll(/^ {4}(\w+):/gm)].map(
    (m) => m[1] as string
  )
  return { type, body, args }
}

/** Source with the whitespace around `.` removed, so a split chain reads as one. */
function flat(source: string): string {
  return source.replace(/\s*\.\s*(?=[A-Za-z_$])/g, '.')
}

/** What `ctx` serves in `source`: `db.get`, `runQuery`, or a helper it is passed to. */
function ctxUses(source: string): string[] {
  const uses = [
    ...[...source.matchAll(/\bctx\.db\.(\w+)/g)].map((m) => `db.${m[1]}`),
    ...[...source.matchAll(/\bctx\.(?!db\.)(\w+)/g)].map((m) => m[1]),
    ...[...source.matchAll(/(\w+)\(\s*ctx\b/g)].map((m) => m[1]),
  ]
  return [...new Set(uses)].sort() as string[]
}

/** `internal.chain.tabReconcile.reconcile` as `chain/tabReconcile:reconcile`. */
function functionPath(call: string): string {
  const parts = call.replace(/^internal\./, '').split('.')
  const name = parts.pop() as string
  return `${parts.join('/')}:${name}`
}

/** The one mutation a listed action may run; its dry-run return is checked. */
const DRY_RUN_MUTATIONS: Readonly<Record<string, string>> = {
  'chain/tabReconcile:run': 'internal.chain.tabReconcile.reconcile',
}

describe('read-only path: the listed functions in the Convex source', () => {
  it.each(LIVE_READ_FUNCTION_NAMES.map((fn) => [fn]))(
    '%s has the recorded type and accepts the listed arguments',
    (fn) => {
      const entry = LIVE_READ_FUNCTIONS[fn]!
      const source = convexExport(fn)
      expect(source.type).toBe(entry.type)
      for (const name of Object.keys(entry.args)) {
        expect(source.args).toContain(name)
      }
      if (entry.type === 'query' || entry.type === 'internalQuery') {
        expect(entry.calls).toBeUndefined()
        return
      }
      // An action: only the recorded calls, and nothing that writes or
      // schedules outside them.
      expect(entry.calls?.length).toBeGreaterThan(0)
      const calls = [...source.body.matchAll(/internal\.[\w.]+/g)].map(
        (m) => m[0]
      )
      expect(new Set(calls)).toEqual(new Set(entry.calls))
      expect(source.body).not.toMatch(
        /runAction|scheduler|fetch\(|ctx\.storage/
      )
      // The handler hands `ctx` to no helper, and uses it only to run
      // queries, plus its one dry-run mutation where it has one.
      const body = flat(source.body)
      expect(body).not.toMatch(/\w\(\s*ctx\b/)
      const dryRun = DRY_RUN_MUTATIONS[fn]
      expect(
        [
          ...new Set([...body.matchAll(/\bctx\.(\w+)/g)].map((m) => m[1])),
        ].sort()
      ).toEqual(dryRun ? ['runMutation', 'runQuery'] : ['runQuery'])
      // Each call runs the recorded function by the right method, and the
      // function it runs is a query, except that dry-run mutation.
      for (const call of entry.calls ?? []) {
        const sites = [
          ...body.matchAll(
            new RegExp(
              `ctx\\.(\\w+)\\(\\s*${call.replace(/\./g, '\\.')}\\b`,
              'g'
            )
          ),
        ].map((m) => m[1])
        expect(sites.length).toBeGreaterThan(0)
        const callee = convexExport(functionPath(call))
        if (call === dryRun) {
          expect(callee.type).toBe('internalMutation')
          expect(new Set(sites)).toEqual(new Set(['runMutation']))
        } else {
          expect(['query', 'internalQuery']).toContain(callee.type)
          expect(new Set(sites)).toEqual(new Set(['runQuery']))
        }
      }
    }
  )

  it('tabReconcile:run passes apply only when it is true, and reconcile writes nothing before its dry-run return', () => {
    const run = convexExport('chain/tabReconcile:run')
    expect(run.args).toEqual(['reader', 'keyId', 'writer', 'apply', 'note'])
    expect(run.body).toContain('apply: args.apply === true')
    expect(run.body.match(/ctx\.runMutation\(/g)).toHaveLength(1)
    expect(run.body).toMatch(
      /ctx\.runMutation\(internal\.chain\.tabReconcile\.reconcile,/
    )
    const reconcile = convexExport('chain/tabReconcile:reconcile')
    expect(reconcile.type).toBe('internalMutation')
    const dryReturn = reconcile.body.indexOf('if (!args.apply) {')
    expect(dryReturn).toBeGreaterThan(0)
    const firstWrite = reconcile.body.search(
      /ctx\.db\.(insert|patch|replace|delete)|applyPairSettlement|releasePairReserve|pruneBalanceDebits|recordReserveRelease|ctx\.scheduler/
    )
    expect(firstWrite).toBeGreaterThan(dryReturn)
    // Before the dry-run return `ctx` serves reads only: `ctx.db.get`,
    // `ctx.db.query`, and `accountVouchers`, which only queries. A new
    // helper that takes `ctx` there fails this check until it is reviewed.
    const before = flat(reconcile.body.slice(0, dryReturn))
    expect(ctxUses(before)).toEqual(['accountVouchers', 'db.get', 'db.query'])
    const source = flat(
      fs.readFileSync(path.join(REPO, 'convex/chain/tabReconcile.ts'), 'utf8')
    )
    // The helper's body, from the brace after its signature to its end.
    const helper = /async function accountVouchers\([^{]*\{([\s\S]*?)\n\}/.exec(
      source
    )?.[1]
    expect(helper).toBeDefined()
    expect(ctxUses(helper ?? '')).toEqual(['db.query'])
    // The chain read is a simulation: the module calls no other RPC method
    // and holds no signing key.
    expect([
      ...new Set([...source.matchAll(/\brpc\.(\w+)\(/g)].map((m) => m[1])),
    ]).toEqual(['simulateTransaction'])
    expect(source).not.toMatch(/sendTransaction|Keypair|_SECRET/)
  })

  it('the window apply shape matches the function arguments', () => {
    const run = convexExport('chain/tabReconcile:run')
    const shape = LIVE_WINDOW_FUNCTION_SHAPES['chain/tabReconcile:run']!
    for (const name of Object.keys(shape.args)) {
      expect(run.args).toContain(name)
    }
    expect(Object.keys(shape.args)).toEqual(['reader', 'apply', 'note'])
  })

  it('no read-only entry is a mutation, and each records why it writes nothing', () => {
    for (const fn of LIVE_READ_FUNCTION_NAMES) {
      const entry = LIVE_READ_FUNCTIONS[fn]!
      expect(['query', 'internalQuery', 'action', 'internalAction']).toContain(
        entry.type
      )
      expect(entry.readOnly.length).toBeGreaterThan(20)
    }
  })
})
