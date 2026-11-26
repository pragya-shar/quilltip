/// <reference types="vite/client" />
// Proof of wallet control before an address is linked (convex/walletLink.ts).
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Keypair,
  Networks,
  TransactionBuilder,
  type Transaction,
} from '@stellar/stellar-sdk'
import schema from '../../convex/schema'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import {
  WALLET_CHALLENGE_TTL_MS,
  challengeMessage,
  checkWalletProof,
  decodeSignature,
} from '../../convex/lib/walletChallenge'

const modules = import.meta.glob('../../convex/**/*.ts')
const ORIGIN = 'http://localhost:3000'
const T0 = Date.UTC(2026, 11, 1, 12, 0, 0)

beforeEach(() => {
  vi.useFakeTimers({ now: T0 })
  vi.stubEnv('STELLAR_NETWORK', 'TESTNET')
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

type T = ReturnType<typeof convexTest>

async function newUser(t: T, username: string, extra = {}) {
  return t.run(({ db }) =>
    db.insert('users', {
      username,
      email: `${username}@example.test`,
      createdAt: T0,
      updatedAt: T0,
      ...extra,
    })
  )
}

const as = (t: T, id: Id<'users'>) =>
  t.withIdentity({ subject: `${id}|session` })

function signMessage(key: Keypair, message: string): string {
  return btoa(String.fromCharCode(...key.signMessage(message)))
}

function signTransaction(
  key: Keypair,
  xdr: string,
  passphrase: string = Networks.TESTNET
): string {
  const tx = TransactionBuilder.fromXDR(xdr, passphrase) as Transaction
  tx.sign(key)
  return tx.toXDR()
}

async function setup() {
  const t = convexTest(schema, modules)
  const writer = await newUser(t, 'writer')
  const key = Keypair.random()
  const challenge = await as(t, writer).mutation(
    api.walletLink.createWalletChallenge,
    { address: key.publicKey(), origin: ORIGIN }
  )
  return { t, writer, key, challenge }
}

describe('createWalletChallenge', () => {
  it('binds the account, address, network, origin and a short lifetime', async () => {
    const { t, writer, key, challenge } = await setup()
    expect(challenge.networkPassphrase).toBe(Networks.TESTNET)
    expect(challenge.expiresAt).toBe(T0 + WALLET_CHALLENGE_TTL_MS)
    for (const part of [
      key.publicKey(),
      writer,
      Networks.TESTNET,
      ORIGIN,
      'does not move funds',
    ]) {
      expect(challenge.message).toContain(part)
    }
    const tx = TransactionBuilder.fromXDR(
      challenge.transactionXdr,
      Networks.TESTNET
    ) as Transaction
    expect(tx.source).toBe(key.publicKey())
    expect(tx.sequence).toBe('0')
    expect(tx.operations.map((op) => op.type)).toEqual([
      'manageData',
      'manageData',
      'manageData',
    ])
    expect(tx.timeBounds).toEqual({
      minTime: String(T0 / 1000),
      maxTime: String((T0 + WALLET_CHALLENGE_TTL_MS) / 1000),
    })
    const row = await t.run(({ db }) => db.get(challenge.challengeId))
    expect(row?.userId).toBe(writer)
  })

  it('needs a signed-in user, a valid address and an allowed origin', async () => {
    const t = convexTest(schema, modules)
    const writer = await newUser(t, 'writer')
    const address = Keypair.random().publicKey()
    await expect(
      t.mutation(api.walletLink.createWalletChallenge, {
        address,
        origin: ORIGIN,
      })
    ).rejects.toThrow('NOT_AUTHENTICATED')
    await expect(
      as(t, writer).mutation(api.walletLink.createWalletChallenge, {
        address: 'GNOTANADDRESS',
        origin: ORIGIN,
      })
    ).rejects.toThrow('INVALID_ADDRESS')
    await expect(
      as(t, writer).mutation(api.walletLink.createWalletChallenge, {
        address,
        origin: 'https://other.example',
      })
    ).rejects.toThrow('ORIGIN_NOT_ALLOWED')
    vi.stubEnv('SITE_URL', 'https://quilltip.example')
    await expect(
      as(t, writer).mutation(api.walletLink.createWalletChallenge, {
        address,
        origin: ORIGIN,
      })
    ).rejects.toThrow('ORIGIN_NOT_ALLOWED')
    await expect(
      as(t, writer).mutation(api.walletLink.createWalletChallenge, {
        address,
        origin: 'https://quilltip.example/settings',
      })
    ).resolves.toBeTruthy()
  })

  it('limits challenges per user', async () => {
    const t = convexTest(schema, modules)
    const writer = await newUser(t, 'writer')
    const address = Keypair.random().publicKey()
    for (let i = 0; i < 10; i++) {
      await as(t, writer).mutation(api.walletLink.createWalletChallenge, {
        address,
        origin: ORIGIN,
      })
    }
    await expect(
      as(t, writer).mutation(api.walletLink.createWalletChallenge, {
        address,
        origin: ORIGIN,
      })
    ).rejects.toThrow('RATE_LIMITED')
  })
})

describe('verifyWalletChallenge', () => {
  it('links the address as verified with a SEP-53 message signature', async () => {
    const { t, writer, key, challenge } = await setup()
    const result = await as(t, writer).mutation(
      api.walletLink.verifyWalletChallenge,
      {
        challengeId: challenge.challengeId,
        origin: ORIGIN,
        proof: {
          kind: 'message',
          signature: signMessage(key, challenge.message),
        },
      }
    )
    expect(result).toEqual({
      ok: true,
      address: key.publicKey(),
      verifiedAt: expect.any(Number),
    })
    const verifiedAt = (result as { verifiedAt: number }).verifiedAt
    expect(verifiedAt).toBeGreaterThanOrEqual(T0)
    expect(verifiedAt).toBeLessThan(challenge.expiresAt)
    expect(
      await as(t, writer).query(api.walletLink.getMyWalletLink, {})
    ).toEqual({
      address: key.publicKey(),
      state: 'verified',
      verifiedAt,
      networkPassphrase: Networks.TESTNET,
    })
  })

  it('accepts the signed fallback transaction for wallets without message signing', async () => {
    const { t, writer, key, challenge } = await setup()
    const result = await as(t, writer).mutation(
      api.walletLink.verifyWalletChallenge,
      {
        challengeId: challenge.challengeId,
        origin: ORIGIN,
        proof: {
          kind: 'transaction',
          signedXdr: signTransaction(key, challenge.transactionXdr),
        },
      }
    )
    expect(result).toMatchObject({ ok: true, address: key.publicKey() })
  })

  it('refuses a replayed challenge', async () => {
    const { t, writer, key, challenge } = await setup()
    const proof = {
      kind: 'message' as const,
      signature: signMessage(key, challenge.message),
    }
    const args = { challengeId: challenge.challengeId, origin: ORIGIN, proof }
    expect(
      await as(t, writer).mutation(api.walletLink.verifyWalletChallenge, args)
    ).toMatchObject({ ok: true })
    expect(
      await as(t, writer).mutation(api.walletLink.verifyWalletChallenge, args)
    ).toEqual({ ok: false, reason: 'CHALLENGE_USED' })
  })

  it('refuses an expired challenge and uses it up', async () => {
    const { t, writer, key, challenge } = await setup()
    vi.setSystemTime(T0 + WALLET_CHALLENGE_TTL_MS + 1)
    const args = {
      challengeId: challenge.challengeId,
      origin: ORIGIN,
      proof: {
        kind: 'message' as const,
        signature: signMessage(key, challenge.message),
      },
    }
    expect(
      await as(t, writer).mutation(api.walletLink.verifyWalletChallenge, args)
    ).toEqual({ ok: false, reason: 'CHALLENGE_EXPIRED' })
    expect(
      await as(t, writer).mutation(api.walletLink.verifyWalletChallenge, args)
    ).toEqual({ ok: false, reason: 'CHALLENGE_USED' })
    expect(
      await as(t, writer).query(api.walletLink.getMyWalletLink, {})
    ).toMatchObject({ state: 'none' })
  })

  it('refuses another account’s challenge without using it up', async () => {
    const { t, writer, key, challenge } = await setup()
    const other = await newUser(t, 'other')
    const args = {
      challengeId: challenge.challengeId,
      origin: ORIGIN,
      proof: {
        kind: 'message' as const,
        signature: signMessage(key, challenge.message),
      },
    }
    expect(
      await as(t, other).mutation(api.walletLink.verifyWalletChallenge, args)
    ).toEqual({ ok: false, reason: 'CHALLENGE_NOT_FOUND' })
    expect(
      await as(t, other).query(api.walletLink.getMyWalletLink, {})
    ).toMatchObject({ state: 'none' })
    expect(
      await as(t, writer).mutation(api.walletLink.verifyWalletChallenge, args)
    ).toMatchObject({ ok: true })
  })

  it('refuses a proof made for another network', async () => {
    const { t, writer, key, challenge } = await setup()
    // The wallet signed the same transaction for mainnet.
    const signedForMainnet = signTransaction(
      key,
      challenge.transactionXdr,
      Networks.PUBLIC
    )
    expect(
      await as(t, writer).mutation(api.walletLink.verifyWalletChallenge, {
        challengeId: challenge.challengeId,
        origin: ORIGIN,
        proof: { kind: 'transaction', signedXdr: signedForMainnet },
      })
    ).toEqual({ ok: false, reason: 'SIGNATURE_INVALID' })
  })

  it('refuses a challenge issued for a network the backend no longer uses', async () => {
    const { t, writer, key, challenge } = await setup()
    await t.run(({ db }) =>
      db.patch(challenge.challengeId, { networkPassphrase: Networks.PUBLIC })
    )
    expect(
      await as(t, writer).mutation(api.walletLink.verifyWalletChallenge, {
        challengeId: challenge.challengeId,
        origin: ORIGIN,
        proof: {
          kind: 'message',
          signature: signMessage(key, challenge.message),
        },
      })
    ).toEqual({ ok: false, reason: 'NETWORK_MISMATCH' })
  })

  it('refuses a proof sent from another origin', async () => {
    const { t, writer, key, challenge } = await setup()
    expect(
      await as(t, writer).mutation(api.walletLink.verifyWalletChallenge, {
        challengeId: challenge.challengeId,
        origin: 'http://localhost:4000',
        proof: {
          kind: 'message',
          signature: signMessage(key, challenge.message),
        },
      })
    ).toEqual({ ok: false, reason: 'ORIGIN_MISMATCH' })
  })

  it('refuses a signature by a different key, or over different text', async () => {
    const { t, writer, key, challenge } = await setup()
    const stranger = Keypair.random()
    for (const signature of [
      signMessage(stranger, challenge.message),
      signMessage(key, challenge.message.replace('Nonce', 'nonce')),
      'not a signature',
    ]) {
      const fresh = await as(t, writer).mutation(
        api.walletLink.createWalletChallenge,
        { address: key.publicKey(), origin: ORIGIN }
      )
      const reused =
        signature === 'not a signature'
          ? signature
          : signature === signMessage(stranger, challenge.message)
            ? signMessage(stranger, fresh.message)
            : signMessage(key, fresh.message.replace('Nonce', 'nonce'))
      expect(
        await as(t, writer).mutation(api.walletLink.verifyWalletChallenge, {
          challengeId: fresh.challengeId,
          origin: ORIGIN,
          proof: { kind: 'message', signature: reused },
        })
      ).toEqual({ ok: false, reason: 'SIGNATURE_INVALID' })
    }
    // A transaction signed by another key, and a changed transaction.
    expect(
      await as(t, writer).mutation(api.walletLink.verifyWalletChallenge, {
        challengeId: challenge.challengeId,
        origin: ORIGIN,
        proof: {
          kind: 'transaction',
          signedXdr: signTransaction(stranger, challenge.transactionXdr),
        },
      })
    ).toEqual({ ok: false, reason: 'SIGNATURE_INVALID' })
    const other = await as(t, writer).mutation(
      api.walletLink.createWalletChallenge,
      { address: key.publicKey(), origin: ORIGIN }
    )
    expect(
      await as(t, writer).mutation(api.walletLink.verifyWalletChallenge, {
        challengeId: other.challengeId,
        origin: ORIGIN,
        // Signed, but for an earlier challenge's transaction.
        proof: {
          kind: 'transaction',
          signedXdr: signTransaction(key, challenge.transactionXdr),
        },
      })
    ).toEqual({ ok: false, reason: 'TRANSACTION_CHANGED' })
    expect(
      await as(t, writer).query(api.walletLink.getMyWalletLink, {})
    ).toMatchObject({ state: 'none' })
  })

  it('lets only one of two concurrent attempts on one challenge succeed', async () => {
    const { t, writer, key, challenge } = await setup()
    const args = {
      challengeId: challenge.challengeId,
      origin: ORIGIN,
      proof: {
        kind: 'message' as const,
        signature: signMessage(key, challenge.message),
      },
    }
    const results = await Promise.all([
      as(t, writer).mutation(api.walletLink.verifyWalletChallenge, args),
      as(t, writer).mutation(api.walletLink.verifyWalletChallenge, args),
    ])
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok)).toEqual([
      { ok: false, reason: 'CHALLENGE_USED' },
    ])
  })

  it('lets only one of two accounts racing to verify one address succeed', async () => {
    const t = convexTest(schema, modules)
    const key = Keypair.random()
    const first = await newUser(t, 'first')
    const second = await newUser(t, 'second')
    const [a, b] = await Promise.all(
      [first, second].map((id) =>
        as(t, id).mutation(api.walletLink.createWalletChallenge, {
          address: key.publicKey(),
          origin: ORIGIN,
        })
      )
    )
    const attempts = [
      { id: first, challenge: a! },
      { id: second, challenge: b! },
    ]
    const results = await Promise.all(
      attempts.map(({ id, challenge }) =>
        as(t, id).mutation(api.walletLink.verifyWalletChallenge, {
          challengeId: challenge.challengeId,
          origin: ORIGIN,
          proof: {
            kind: 'message',
            signature: signMessage(key, challenge.message),
          },
        })
      )
    )
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok)).toEqual([
      { ok: false, reason: 'ADDRESS_IN_USE' },
    ])
    const verified = await t.run(({ db }) =>
      db
        .query('users')
        .collect()
        .then((users) => users.filter((u) => u.stellarAddressVerifiedAt))
    )
    expect(verified).toHaveLength(1)
  })
})

describe('addresses linked before proof was required', () => {
  async function legacy() {
    const t = convexTest(schema, modules)
    const address = Keypair.random().publicKey()
    const writer = await newUser(t, 'legacy', { stellarAddress: address })
    const reader = await newUser(t, 'reader')
    const articleId = await t.run(({ db }) =>
      db.insert('articles', {
        slug: 'words',
        title: 'Words',
        content: { type: 'doc', content: [] },
        published: true,
        authorId: writer,
        authorUsername: 'legacy',
        createdAt: T0,
        updatedAt: T0,
      })
    )
    return { t, address, writer, reader, articleId }
  }

  it('are shown to the owner as not verified and are not public', async () => {
    const { t, address, writer } = await legacy()
    expect(
      await as(t, writer).query(api.walletLink.getMyWalletLink, {})
    ).toMatchObject({ address, state: 'unverified', verifiedAt: null })
    const profile = await t.query(api.users.getUserByUsername, {
      username: 'legacy',
    })
    expect(profile?.stellarAddress).toBeNull()
  })

  it('receive no new tips until verified', async () => {
    const { t, reader, articleId } = await legacy()
    await expect(
      as(t, reader).mutation(api.tips.prepareArticleTip, {
        articleId,
        amountXlm: 1,
        stellarSourceAccount: Keypair.random().publicKey(),
      })
    ).rejects.toThrow('Author has not verified a receiving wallet')
  })

  it('cannot have a highlight tip recorded through the receipt path', async () => {
    const { t, reader, articleId } = await legacy()
    await t.run(({ db }) =>
      db.patch(articleId, {
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Hello world' }],
            },
          ],
        },
      })
    )
    await expect(
      as(t, reader).mutation(api.highlightTips.create, {
        highlightId: 'x',
        articleId,
        highlightText: 'Hello',
        startOffset: 0,
        endOffset: 5,
        amountCents: 100,
        stellarTxId: 'ab'.repeat(32),
        stellarMemo: 'x',
        stellarSourceAccount: Keypair.random().publicKey(),
        stellarAmountXlm: '5',
      })
    ).rejects.toThrow('Author has not verified a receiving wallet')
  })

  it('cannot publish a new article until verified', async () => {
    const { t, writer } = await legacy()
    const draft = await t.run(({ db }) =>
      db.insert('articles', {
        slug: 'draft',
        title: 'Draft',
        content: { type: 'doc', content: [] },
        published: false,
        authorId: writer,
        authorUsername: 'legacy',
        createdAt: T0,
        updatedAt: T0,
      })
    )
    await expect(
      as(t, writer).mutation(api.articles.publishArticle, { id: draft })
    ).rejects.toThrow('Verify your receiving wallet before publishing')
  })

  it('keep recorded v1 tips in the writer’s received list', async () => {
    const { t, writer, reader, articleId } = await legacy()
    await t.run(({ db }) =>
      db.insert('tips', {
        tipperId: reader,
        authorId: writer,
        articleId,
        articleTitle: 'Words',
        articleSlug: 'words',
        amountUsd: 1,
        amountCents: 100,
        stellarTxId: 'a'.repeat(64),
        status: 'CONFIRMED',
        verifiedAt: T0,
        createdAt: T0,
        updatedAt: T0,
      })
    )
    const received = await as(t, writer).query(api.tips.getUserReceivedTips, {})
    expect(received).toHaveLength(1)
  })

  it('keep v2 earnings already credited to the writer', async () => {
    const { t, writer } = await legacy()
    await t.run(({ db }) =>
      db.insert('authorEarnings', {
        userId: writer,
        totalEarnedUsd: 0.1,
        totalEarnedCents: 10,
        availableBalanceUsd: 0,
        availableBalanceCents: 0,
        pendingBalanceUsd: 0,
        pendingBalanceCents: 0,
        withdrawnUsd: 0,
        withdrawnCents: 0,
        tipCount: 1,
        earnedBaseUnits: { TOKEN: '975000' },
        v2TipCount: 1,
        v2EarnedCents: 10,
        createdAt: T0,
        updatedAt: T0,
      } as never)
    )
    expect(
      await as(t, writer).query(api.tips.getMyEarningsSummary, {})
    ).toMatchObject({ earnedBaseUnits: { TOKEN: '975000' }, v2TipCount: 1 })
  })

  it('become verified after proof at the next connect', async () => {
    const { t, address, writer } = await legacy()
    // The owner's wallet holds the key for the legacy address.
    const key = Keypair.random()
    await t.run(({ db }) =>
      db.patch(writer, { stellarAddress: key.publicKey() })
    )
    const challenge = await as(t, writer).mutation(
      api.walletLink.createWalletChallenge,
      { address: key.publicKey(), origin: ORIGIN }
    )
    expect(
      await as(t, writer).mutation(api.walletLink.verifyWalletChallenge, {
        challengeId: challenge.challengeId,
        origin: ORIGIN,
        proof: {
          kind: 'message',
          signature: signMessage(key, challenge.message),
        },
      })
    ).toMatchObject({ ok: true })
    expect(address).not.toBe(key.publicKey())
    expect(
      (await t.query(api.users.getUserByUsername, { username: 'legacy' }))
        ?.stellarAddress
    ).toBe(key.publicKey())
  })

  it('cannot be set by updateProfile; removing clears verification', async () => {
    const { t, writer } = await setup()
    await expect(
      as(t, writer).mutation(api.users.updateProfile, {
        stellarAddress: Keypair.random().publicKey(),
      })
    ).rejects.toThrow('Verify the wallet to link it')
    await as(t, writer).mutation(api.users.updateProfile, {
      stellarAddress: null,
    })
    const user = await t.run(({ db }) => db.get(writer))
    expect(user).toMatchObject({ stellarAddress: null })
    expect(user?.stellarAddressVerifiedAt).toBeUndefined()
    expect(user?.stellarAddressVerifiedNetwork).toBeUndefined()
  })
})

describe('walletChallenge helpers', () => {
  const fields = {
    address: Keypair.random().publicKey(),
    userId: 'user123',
    networkPassphrase: Networks.TESTNET,
    origin: ORIGIN,
    nonce: '00'.repeat(16),
    issuedAt: T0,
    expiresAt: T0 + WALLET_CHALLENGE_TTL_MS,
  }

  it('decodes base64 and hex signatures and rejects other lengths', () => {
    const bytes = new Uint8Array(64).fill(7)
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(
      ''
    )
    expect(decodeSignature(btoa(String.fromCharCode(...bytes)))).toEqual(bytes)
    expect(decodeSignature(hex)).toEqual(bytes)
    expect(decodeSignature(btoa('short'))).toBeNull()
  })

  it('the message is stable for a challenge', () => {
    expect(challengeMessage(fields)).toBe(challengeMessage({ ...fields }))
    expect(
      checkWalletProof(fields, { kind: 'message', signature: '' })
    ).toEqual({ ok: false, reason: 'SIGNATURE_INVALID' })
  })
})
