/// <reference types="vite/client" />
/**
 * `publishing.registrationState`: the writer's own view of whether readers
 * can tip an article, for the Publish sheet and the tip context. Only the
 * article's author gets an answer, and the answer holds no address, hash,
 * transaction or wallet detail.
 */
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from '../../convex/schema'
import { api } from '../../convex/_generated/api'
import type { Doc, Id } from '../../convex/_generated/dataModel'
import { CORE, seedAddress } from '../chain/fixtures'

const modules = import.meta.glob('../../convex/**/*.ts')
const TESTNET = 'Test SDF Network ; September 2015'
const EPOCH = 'testnet-test'
const WALLET = seedAddress(41)
const NEW_WALLET = seedAddress(42)

beforeEach(() => {
  vi.useFakeTimers({ now: Date.UTC(2026, 11, 1) })
  for (const [k, val] of Object.entries({
    STELLAR_NETWORK: 'TESTNET',
    CHAIN_V2_ENABLED: 'true',
    CHAIN_EPOCH: EPOCH,
    CORE_CONTRACT_ID: CORE,
  })) {
    vi.stubEnv(k, val)
  }
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

type RowStatus = Doc<'chainArticles'>['status']

async function setup(opts: { verified?: boolean; published?: boolean } = {}) {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const user = (username: string, verified: boolean) =>
      ctx.db.insert('users', {
        email: `${username}@example.test`,
        username,
        name: username,
        ...(verified
          ? {
              stellarAddress: WALLET,
              stellarAddressVerifiedAt: 1,
              stellarAddressVerifiedNetwork: TESTNET,
            }
          : {}),
        createdAt: 1,
        updatedAt: 1,
      })
    const writer = await user('ines', opts.verified ?? true)
    const other = await user('omar', true)
    const article = await ctx.db.insert('articles', {
      title: 'Morning crossing',
      slug: 'morning-crossing',
      content: { type: 'doc', content: [] },
      authorId: writer,
      authorUsername: 'ines',
      published: opts.published ?? true,
      publishedAt: opts.published === false ? undefined : 1,
      createdAt: 1,
      updatedAt: 1,
    })
    return { writer, other, article }
  })
  return {
    t,
    ids,
    writer: t.withIdentity({ subject: `${ids.writer}|session` }),
    other: t.withIdentity({ subject: `${ids.other}|session` }),
  }
}

type World = Awaited<ReturnType<typeof setup>>

async function addRow(
  w: World,
  status: RowStatus,
  opts: {
    epoch?: string
    author?: string
    submission?: { kind: 'register' | 'content_update'; needsReview: boolean }
  } = {}
) {
  await w.t.run(async (ctx) => {
    const lastSubmissionId = opts.submission
      ? await ctx.db.insert('chainSubmissions', {
          network: 'TESTNET',
          chainEpoch: opts.epoch ?? EPOCH,
          kind: opts.submission.kind,
          userId: w.ids.writer,
          contractId: CORE,
          requestId: 'r1',
          clientRefs: [],
          txHash: 'ab'.repeat(32),
          maxTime: 1,
          status: status === 'FAILED' ? 'FAILED' : 'SUBMITTED',
          attempts: 1,
          needsReview: opts.submission.needsReview,
          mismatchReason: 'secret-mismatch-reason',
          lastError: 'secret-last-error',
          related: [],
          createdAt: 1,
          updatedAt: 1,
        } as never)
      : undefined
    await ctx.db.insert('chainArticles', {
      network: 'TESTNET',
      chainEpoch: opts.epoch ?? EPOCH,
      articleId: w.ids.article,
      articleKey: 'ab'.repeat(32),
      authorAddress: opts.author ?? WALLET,
      contentHash: 'cd'.repeat(32),
      contentVersion: 1,
      splits: [],
      totals: {},
      status,
      txHash: 'ef'.repeat(32),
      ...(lastSubmissionId ? { lastSubmissionId } : {}),
      updatedAt: 1,
    })
  })
}

const read = (w: World, who: 'writer' | 'other' = 'writer') =>
  w[who].query(api.publishing.registrationState, { articleId: w.ids.article })

describe('publishing.registrationState: who gets an answer', () => {
  test('signed out, another writer and a missing article get null', async () => {
    const w = await setup()
    await addRow(w, 'REGISTERED')
    expect(
      await w.t.query(api.publishing.registrationState, {
        articleId: w.ids.article,
      })
    ).toBeNull()
    expect(await read(w, 'other')).toBeNull()
    const gone = await w.t.run(async (ctx) => {
      await ctx.db.delete(w.ids.article)
      return w.ids.article
    })
    expect(
      await w.writer.query(api.publishing.registrationState, {
        articleId: gone as Id<'articles'>,
      })
    ).toBeNull()
  })

  test('the answer holds no address, hash, key or transaction', async () => {
    const w = await setup()
    await addRow(w, 'REGISTERED')
    const state = await read(w)
    expect(state).toEqual({
      state: 'registered',
      published: true,
      payoutOutdated: false,
    })
    const text = JSON.stringify(state)
    for (const secret of [
      WALLET,
      'ab'.repeat(32),
      'cd'.repeat(32),
      'ef'.repeat(32),
      CORE,
    ]) {
      expect(text).not.toContain(secret)
    }
  })
})

describe('publishing.registrationState: states', () => {
  test('no row: not registered, and the next step is to turn tips on', async () => {
    const w = await setup()
    expect(await read(w)).toEqual({
      state: 'not_registered',
      published: true,
      next: 'turn_on',
    })
  })

  test('a draft must be published first', async () => {
    const w = await setup({ published: false })
    expect(await read(w)).toEqual({
      state: 'not_registered',
      published: false,
      next: 'publish',
    })
  })

  test('without a verified wallet the next step is the wallet', async () => {
    const w = await setup({ verified: false })
    expect(await read(w)).toEqual({
      state: 'not_registered',
      published: true,
      next: 'verify_wallet',
    })
  })

  test('a failed registration can be tried again', async () => {
    const w = await setup()
    await addRow(w, 'FAILED')
    expect(await read(w)).toEqual({
      state: 'not_registered',
      published: true,
      next: 'retry',
    })
  })

  test('a prepared or submitted registration is pending', async () => {
    for (const status of ['PREPARED', 'SUBMITTED'] as const) {
      const w = await setup()
      await addRow(w, status)
      expect(await read(w)).toEqual({ state: 'pending', published: true })
    }
  })

  test('a registration held for review says so, and nothing more', async () => {
    for (const status of ['SUBMITTED', 'FAILED'] as const) {
      const w = await setup()
      await addRow(w, status, {
        submission: { kind: 'register', needsReview: true },
      })
      const state = await read(w)
      expect(state).toEqual({ state: 'held_for_review', published: true })
      expect(JSON.stringify(state)).not.toContain('secret')
    }
  })

  test('a submission not held is pending; a later update under review keeps registered', async () => {
    const w = await setup()
    await addRow(w, 'SUBMITTED', {
      submission: { kind: 'register', needsReview: false },
    })
    expect(await read(w)).toEqual({ state: 'pending', published: true })
    const v = await setup()
    await addRow(v, 'REGISTERED', {
      submission: { kind: 'content_update', needsReview: true },
    })
    expect(await read(v)).toEqual({
      state: 'registered',
      published: true,
      payoutOutdated: false,
    })
  })

  test('registered, and flagged when the wallet changed since', async () => {
    const w = await setup()
    await addRow(w, 'REGISTERED', { author: NEW_WALLET })
    expect(await read(w)).toEqual({
      state: 'registered',
      published: true,
      payoutOutdated: true,
    })
  })

  test('a row from another contract deployment does not count', async () => {
    const w = await setup()
    await addRow(w, 'REGISTERED', { epoch: 'testnet-older' })
    expect(await read(w)).toEqual({
      state: 'not_registered',
      published: true,
      next: 'turn_on',
    })
  })
})

describe('publishing.registrationState: tips not available here', () => {
  test('payments off, no Core contract, or not testnet: unavailable', async () => {
    const cases: Record<string, string>[] = [
      { CHAIN_V2_ENABLED: 'false' },
      { CORE_CONTRACT_ID: '' },
      { STELLAR_NETWORK: 'MAINNET' },
      { CORE_CONTRACT_ID: 'not-a-contract' },
    ]
    for (const env of cases) {
      const w = await setup()
      await addRow(w, 'REGISTERED')
      for (const [k, val] of Object.entries(env)) vi.stubEnv(k, val)
      expect(await read(w)).toEqual({ state: 'unavailable', published: true })
      vi.stubEnv('CHAIN_V2_ENABLED', 'true')
      vi.stubEnv('CORE_CONTRACT_ID', CORE)
      vi.stubEnv('STELLAR_NETWORK', 'TESTNET')
    }
  })

  test('another writer still gets null when tips are unavailable', async () => {
    const w = await setup()
    vi.stubEnv('CHAIN_V2_ENABLED', 'false')
    expect(await read(w, 'other')).toBeNull()
  })
})

describe('publishing.registrationState: an article published without an address', () => {
  test('write.publish publishes it; its author is told to confirm an address, everyone else gets null', async () => {
    const w = await setup({ verified: false, published: false })
    const d = await w.writer.mutation(api.write.saveDraft, {
      title: 'First words',
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Hello.' }] },
        ],
      },
    })
    await w.writer.mutation(api.write.publish, {
      id: d.id,
      baseUpdatedAt: d.updatedAt,
    })
    const state = (who?: 'writer' | 'other') =>
      who
        ? w[who].query(api.publishing.registrationState, { articleId: d.id })
        : w.t.query(api.publishing.registrationState, { articleId: d.id })
    expect(await state('writer')).toEqual({
      state: 'not_registered',
      published: true,
      next: 'verify_wallet',
    })
    expect(await state('other')).toBeNull()
    expect(await state()).toBeNull()

    // Once the address is confirmed, the next step is to turn tips on.
    await w.t.run((ctx) =>
      ctx.db.patch(w.ids.writer, {
        stellarAddress: WALLET,
        stellarAddressVerifiedAt: 2,
        stellarAddressVerifiedNetwork: TESTNET,
      })
    )
    expect(await state('writer')).toEqual({
      state: 'not_registered',
      published: true,
      next: 'turn_on',
    })
  })
})
