/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { describe, expect, it } from 'vitest'
import { api } from './_generated/api'
import schema from './schema'

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts'])

// Valid testnet-format Stellar address (G + 55 base32 chars)
const VALID_STELLAR_ADDRESS =
  'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV'.padEnd(56, 'A')

async function seedAuthorWithBalance(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now()
    const userId = await ctx.db.insert('users', {
      email: 'author@x.test',
      username: 'author',
      createdAt: now,
      updatedAt: now,
    })
    await ctx.db.insert('authorEarnings', {
      userId,
      totalEarnedUsd: 50,
      totalEarnedCents: 5000,
      availableBalanceUsd: 50,
      availableBalanceCents: 5000,
      pendingBalanceUsd: 0,
      pendingBalanceCents: 0,
      withdrawnUsd: 0,
      withdrawnCents: 0,
      tipCount: 1,
      createdAt: now,
      updatedAt: now,
    })
    return { userId }
  })
}

describe('withdrawEarnings', () => {
  it('rejects NaN amount', async () => {
    const t = convexTest(schema, modules)
    const { userId } = await seedAuthorWithBalance(t)
    const asUser = t.withIdentity({ subject: userId })

    await expect(
      asUser.mutation(api.tips.withdrawEarnings, {
        amountUsd: NaN,
        stellarAddress: VALID_STELLAR_ADDRESS,
      })
    ).rejects.toThrow('Invalid withdrawal amount')
  })

  it('rejects Infinity amount', async () => {
    const t = convexTest(schema, modules)
    const { userId } = await seedAuthorWithBalance(t)
    const asUser = t.withIdentity({ subject: userId })

    await expect(
      asUser.mutation(api.tips.withdrawEarnings, {
        amountUsd: Infinity,
        stellarAddress: VALID_STELLAR_ADDRESS,
      })
    ).rejects.toThrow('Invalid withdrawal amount')
  })

  it('still rejects zero and negative amounts', async () => {
    const t = convexTest(schema, modules)
    const { userId } = await seedAuthorWithBalance(t)
    const asUser = t.withIdentity({ subject: userId })

    await expect(
      asUser.mutation(api.tips.withdrawEarnings, {
        amountUsd: 0,
        stellarAddress: VALID_STELLAR_ADDRESS,
      })
    ).rejects.toThrow('Invalid withdrawal amount')

    await expect(
      asUser.mutation(api.tips.withdrawEarnings, {
        amountUsd: -5,
        stellarAddress: VALID_STELLAR_ADDRESS,
      })
    ).rejects.toThrow('Invalid withdrawal amount')
  })
})
