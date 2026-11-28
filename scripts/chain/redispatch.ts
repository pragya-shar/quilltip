/**
 * Re-dispatch idempotence (#584): every chain event handler must leave the
 * tables as they are when an event it already applied is dispatched again
 * (a re-dispatch after recovery, a rebuilt `chainEvents` table). The helper
 * sets every stored event back to `pending`, dispatches them all again and
 * compares every table, ignoring only `updatedAt` and `_creationTime`.
 */
import { expect } from 'vitest'
import schema from '../../convex/schema'
import { internal } from '../../convex/_generated/api'

type Runner = {
  run: <R>(fn: (ctx: never) => Promise<R>) => Promise<R>
  mutation: (fn: never, args: never) => Promise<unknown>
}

const VOLATILE = new Set(['_creationTime', 'updatedAt'])

async function tables(t: Runner): Promise<Record<string, unknown[]>> {
  return t.run(async (ctx: never) => {
    const db = (
      ctx as {
        db: {
          query: (n: string) => {
            collect: () => Promise<Record<string, unknown>[]>
          }
        }
      }
    ).db
    const out: Record<string, unknown[]> = {}
    for (const name of Object.keys(schema.tables)) {
      const rows = await db.query(name).collect()
      out[name] = rows
        .map((row) =>
          Object.fromEntries(
            Object.entries(row).filter(([k]) => !VOLATILE.has(k))
          )
        )
        .sort((a, b) => (String(a._id) < String(b._id) ? -1 : 1))
    }
    return out
  })
}

/** Re-dispatches every stored event and expects no table to change. */
export async function expectRedispatchChangesNothing(t: unknown) {
  const runner = t as Runner
  const before = await tables(runner)
  await runner.run(async (ctx: never) => {
    const db = (
      ctx as {
        db: {
          query: (n: string) => {
            collect: () => Promise<Array<{ _id: string }>>
          }
          patch: (id: string, v: object) => Promise<void>
        }
      }
    ).db
    for (const row of await db.query('chainEvents').collect()) {
      await db.patch(row._id, { handled: 'pending' })
    }
  })
  for (;;) {
    const r = (await runner.mutation(
      internal.chain.indexer.redispatch as never,
      { limit: 500 } as never
    )) as { checked: number }
    if (r.checked === 0) break
  }
  const after = await tables(runner)
  for (const name of Object.keys(before)) {
    expect(after[name], `table ${name} after a re-dispatch`).toEqual(
      before[name]
    )
  }
}
