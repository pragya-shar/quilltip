/// <reference types="vite/client" />
/**
 * The Write backend (`convex/write.ts`): the desk list, saving a draft
 * without ever overwriting another device's words or clearing the article's
 * other fields, and publishing exactly the text the writer last saw.
 */
import { convexTest } from 'convex-test'
import { ConvexError } from 'convex/values'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import schema from '../../convex/schema'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { DESK_DEFAULT_LIMIT, DESK_MAX_LIMIT } from '../../convex/write'
import { publishContentAnchor } from '../../convex/articles'
import {
  MAX_ARRAY_ITEMS,
  MAX_CONTENT_VALUE_DEPTH,
  MAX_DOCUMENT_JSON_BYTES,
  checkReadingDocument,
  firstLineOf,
} from '../../convex/lib/write/document'

// No network: the permanent-copy uploader is replaced, and its scheduled run
// is never started (fake timers, no finishAllScheduledFunctions).
vi.mock('../../lib/arweave/client', () => ({
  parseWalletKey: () => ({}),
  uploadArticle: async () => {
    throw new Error('the uploader must not run in these tests')
  },
  getTransactionStatus: async () => ({ confirmed: false, confirmations: 0 }),
}))

const modules = import.meta.glob('../../convex/**/*.ts')

const doc = (...paragraphs: string[]) => ({
  type: 'doc',
  content: paragraphs.map((text) => ({
    type: 'paragraph',
    content: text ? [{ type: 'text', text }] : [],
  })),
})
const CLIENT = 'l-0b8a2c4e-5f61-4a7b-9c3d-2e1f0a9b8c7d'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const user = (username: string, verified: boolean) =>
      ctx.db.insert('users', {
        email: `${username}@example.test`,
        username,
        name: username,
        ...(verified
          ? {
              stellarAddress: 'G' + 'A'.repeat(55),
              stellarAddressVerifiedAt: 1,
              stellarAddressVerifiedNetwork:
                'Test SDF Network ; September 2015',
            }
          : {}),
        createdAt: 1,
        updatedAt: 1,
      })
    return { writer: await user('ines', true), other: await user('omar', true) }
  })
  return {
    t,
    ids,
    writer: t.withIdentity({ subject: `${ids.writer}|session` }),
    other: t.withIdentity({ subject: `${ids.other}|session` }),
  }
}

type World = Awaited<ReturnType<typeof setup>>

async function errorData(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  )
  expect(error).toBeInstanceOf(ConvexError)
  return (error as ConvexError<Record<string, string | number>>).data
}

async function errorCode(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  )
  expect(error).toBeInstanceOf(ConvexError)
  return (error as ConvexError<Record<string, string | number>>).data.code
}

async function row(w: World, id: Id<'articles'>) {
  return w.t.run((ctx) => ctx.db.get(id))
}

describe('write.saveDraft refusals', () => {
  test('a stale base is refused and the row is unchanged', async () => {
    const w = await setup()
    const first = await w.writer.mutation(api.write.saveDraft, {
      title: 'Morning crossing',
      content: doc('The ferry leaves at seven.'),
    })
    vi.advanceTimersByTime(10)
    const second = await w.writer.mutation(api.write.saveDraft, {
      id: first.id,
      baseUpdatedAt: first.updatedAt,
      title: 'Morning crossing',
      content: doc('The ferry leaves at seven. Another device wrote this.'),
    })
    expect(second.updatedAt).toBeGreaterThan(first.updatedAt)
    const before = await row(w, first.id)
    expect(
      await errorCode(
        w.writer.mutation(api.write.saveDraft, {
          id: first.id,
          baseUpdatedAt: first.updatedAt,
          title: 'Morning crossing',
          content: doc('This device would overwrite the other one.'),
        })
      )
    ).toBe('draft-changed')
    expect(await row(w, first.id)).toEqual(before)
  })

  test('the refusal says which updatedAt the server has', async () => {
    const w = await setup()
    const first = await w.writer.mutation(api.write.saveDraft, {
      title: 'T',
      content: doc('One.'),
    })
    const error = await w.writer
      .mutation(api.write.saveDraft, {
        id: first.id,
        baseUpdatedAt: first.updatedAt - 1,
        title: 'T',
        content: doc('Two.'),
      })
      .catch((e: ConvexError<{ code: string; updatedAt: number }>) => e)
    expect(
      (error as ConvexError<{ code: string; updatedAt: number }>).data
    ).toEqual({
      code: 'draft-changed',
      updatedAt: first.updatedAt,
    })
  })

  test('another writer’s draft is refused like a missing one, and is not changed', async () => {
    const w = await setup()
    const mine = await w.writer.mutation(api.write.saveDraft, {
      title: 'Mine',
      content: doc('My words.'),
    })
    const before = await row(w, mine.id)
    expect(
      await errorCode(
        w.other.mutation(api.write.saveDraft, {
          id: mine.id,
          baseUpdatedAt: mine.updatedAt,
          title: 'Taken',
          content: doc('Not yours.'),
        })
      )
    ).toBe('draft-not-found')
    // Read after the refused attempt: nothing changed.
    expect(await row(w, mine.id)).toEqual(before)
    await w.t.run((ctx) => ctx.db.delete(mine.id))
    expect(
      await errorCode(
        w.writer.mutation(api.write.saveDraft, {
          id: mine.id,
          baseUpdatedAt: mine.updatedAt,
          title: 'Gone',
          content: doc('Gone.'),
        })
      )
    ).toBe('draft-not-found')
  })

  test('an update without a base is refused and writes nothing', async () => {
    const w = await setup()
    const d = await w.writer.mutation(api.write.saveDraft, {
      title: 'Based',
      content: doc('First words.'),
    })
    const before = await row(w, d.id)
    expect(
      await errorCode(
        w.writer.mutation(api.write.saveDraft, {
          id: d.id,
          title: 'Based',
          content: doc('Words from a tab with no base.'),
        })
      )
    ).toBe('base-required')
    expect(await row(w, d.id)).toEqual(before)
  })

  test('signed out is refused', async () => {
    const w = await setup()
    expect(
      await errorCode(
        w.t.mutation(api.write.saveDraft, { title: 'X', content: doc('Y.') })
      )
    ).toBe('not-signed-in')
  })

  test('a document over the size limit is refused and nothing is written', async () => {
    const w = await setup()
    const big = doc('x'.repeat(MAX_DOCUMENT_JSON_BYTES))
    expect(
      await errorCode(
        w.writer.mutation(api.write.saveDraft, { title: 'Big', content: big })
      )
    ).toBe('draft-too-large')
    expect(await w.t.run((ctx) => ctx.db.query('articles').collect())).toEqual(
      []
    )
    const small = await w.writer.mutation(api.write.saveDraft, {
      title: 'Small',
      content: doc('Short.'),
    })
    const before = await row(w, small.id)
    expect(
      await errorCode(
        w.writer.mutation(api.write.saveDraft, {
          id: small.id,
          baseUpdatedAt: small.updatedAt,
          title: 'Small',
          content: big,
        })
      )
    ).toBe('draft-too-large')
    expect(await row(w, small.id)).toEqual(before)
  })

  test('a published article is refused', async () => {
    const w = await setup()
    const d = await w.writer.mutation(api.write.saveDraft, {
      title: 'Done',
      content: doc('Done.'),
    })
    await w.t.run((ctx) => ctx.db.patch(d.id, { published: true }))
    expect(
      await errorCode(
        w.writer.mutation(api.write.saveDraft, {
          id: d.id,
          baseUpdatedAt: d.updatedAt,
          title: 'Done',
          content: doc('Changed.'),
        })
      )
    ).toBe('draft-published')
  })

  test('a malformed clientId or a title over 200 characters is refused', async () => {
    const w = await setup()
    expect(
      await errorCode(
        w.writer.mutation(api.write.saveDraft, {
          clientId: 'l-not-a-uuid',
          title: 'X',
          content: doc('Y.'),
        })
      )
    ).toBe('invalid-client-id')
    expect(
      await errorCode(
        w.writer.mutation(api.write.saveDraft, {
          title: 'T'.repeat(201),
          content: doc('Y.'),
        })
      )
    ).toBe('title-too-long')
  })
})

describe('write.saveDraft saves', () => {
  test('the article’s other fields are never cleared', async () => {
    const w = await setup()
    const d = await w.writer.mutation(api.write.saveDraft, {
      title: 'Kept',
      content: doc('First.'),
    })
    await w.t.run((ctx) =>
      ctx.db.patch(d.id, {
        excerpt: 'A subtitle.',
        tags: ['Essays'],
        coverImage: 'https://example.test/cover.jpg',
        writerNotes: 'Private notes.',
      })
    )
    const saved = await w.writer.mutation(api.write.saveDraft, {
      id: d.id,
      baseUpdatedAt: (await row(w, d.id))!.updatedAt,
      title: 'Kept, renamed',
      content: doc('Second.'),
    })
    expect(await row(w, d.id)).toMatchObject({
      title: 'Kept, renamed',
      content: doc('Second.'),
      excerpt: 'A subtitle.',
      tags: ['Essays'],
      coverImage: 'https://example.test/cover.jpg',
      writerNotes: 'Private notes.',
      updatedAt: saved.updatedAt,
    })
  })

  test('a create returns { id, updatedAt, created }; an empty title is kept as a draft', async () => {
    const w = await setup()
    const d = await w.writer.mutation(api.write.saveDraft, {
      title: '',
      content: doc('Words before a title.'),
    })
    expect(Object.keys(d).sort()).toEqual(['created', 'id', 'updatedAt'])
    expect(d.created).toBe(true)
    expect(await row(w, d.id)).toMatchObject({
      title: '',
      published: false,
      authorId: w.ids.writer,
      updatedAt: d.updatedAt,
    })
  })

  test('every save moves updatedAt forward, even in the same millisecond', async () => {
    const w = await setup()
    const a = await w.writer.mutation(api.write.saveDraft, {
      title: 'T',
      content: doc('One.'),
    })
    const b = await w.writer.mutation(api.write.saveDraft, {
      id: a.id,
      baseUpdatedAt: a.updatedAt,
      title: 'T',
      content: doc('Two.'),
    })
    expect(b.updatedAt).toBeGreaterThan(a.updatedAt)
  })

  test('the same create twice, by clientId, gives one article and no second write', async () => {
    const w = await setup()
    const first = await w.writer.mutation(api.write.saveDraft, {
      clientId: CLIENT,
      title: 'Once',
      content: doc('Once.'),
    })
    const before = await row(w, first.id)
    const again = await w.writer.mutation(api.write.saveDraft, {
      clientId: CLIENT,
      title: 'Once, retried',
      content: doc('Once, retried.'),
    })
    expect(first.created).toBe(true)
    expect(again).toEqual({ ...first, created: false })
    expect(await row(w, first.id)).toEqual(before)
    expect(
      await w.t.run((ctx) => ctx.db.query('articles').collect())
    ).toHaveLength(1)
  })

  test('created says whether this call made the draft', async () => {
    const w = await setup()
    const fresh = await w.writer.mutation(api.write.saveDraft, {
      title: 'No client id',
      content: doc('One.'),
    })
    expect(fresh.created).toBe(true)
    const update = await w.writer.mutation(api.write.saveDraft, {
      id: fresh.id,
      baseUpdatedAt: fresh.updatedAt,
      title: 'No client id',
      content: doc('One. Two.'),
    })
    expect(update.created).toBe(false)
    const known = await w.writer.mutation(api.write.saveDraft, {
      clientId: CLIENT,
      title: 'Device draft',
      content: doc('Words.'),
    })
    expect(known.created).toBe(true)
    // The device lost its answer and asks again: the server holds this draft.
    const repeat = await w.writer.mutation(api.write.saveDraft, {
      clientId: CLIENT,
      title: 'Device draft',
      content: doc('Words.'),
    })
    expect(repeat).toEqual({
      id: known.id,
      updatedAt: known.updatedAt,
      created: false,
    })
    // A known id whose draft was deleted since makes a new draft.
    await w.t.run((ctx) => ctx.db.delete(known.id))
    const again = await w.writer.mutation(api.write.saveDraft, {
      clientId: CLIENT,
      title: 'Device draft',
      content: doc('Words.'),
    })
    expect(again.created).toBe(true)
    expect(again.id).not.toBe(known.id)
  })

  test('another author’s clientId is not matched', async () => {
    const w = await setup()
    const mine = await w.writer.mutation(api.write.saveDraft, {
      clientId: CLIENT,
      title: 'Mine',
      content: doc('Mine.'),
    })
    const theirs = await w.other.mutation(api.write.saveDraft, {
      clientId: CLIENT,
      title: 'Theirs',
      content: doc('Theirs.'),
    })
    expect(theirs.id).not.toBe(mine.id)
    expect((await row(w, theirs.id))!.authorId).toBe(w.ids.other)
  })
})

describe('write.saveDraft nesting', () => {
  /** Node level `levels`: doc, quotes, a paragraph, then `leaf`. */
  const nested = (levels: number, leaf: object) => {
    let node: object = { type: 'paragraph', content: [leaf] }
    for (let i = 0; i < levels - 3; i++)
      node = { type: 'blockquote', content: [node] }
    return { type: 'doc', content: [node] }
  }
  const text = { type: 'text', text: 'Deep words.' }
  const link = {
    type: 'text',
    text: 'Linked.',
    marks: [{ type: 'link', attrs: { href: 'https://example.test' } }],
  }
  const image = { type: 'image', attrs: { src: 'https://example.test/a.png' } }

  test('saves up to the backend limit and refuses past it, by name', async () => {
    const w = await setup()
    for (const [leaf, deepest] of [
      [text, 8],
      [image, 7],
      [link, 6],
    ] as const) {
      const ok = await w.writer.mutation(api.write.saveDraft, {
        title: 'Deep',
        content: nested(deepest, leaf),
      })
      expect(ok.created).toBe(true)
      const before = await w.t.run((ctx) => ctx.db.query('articles').collect())
      const error = await errorData(
        w.writer.mutation(api.write.saveDraft, {
          title: 'Too deep',
          content: nested(deepest + 1, leaf),
        })
      )
      expect(error).toEqual({
        code: 'document-too-nested',
        maxValueDepth: MAX_CONTENT_VALUE_DEPTH,
      })
      expect(
        await w.t.run((ctx) => ctx.db.query('articles').collect())
      ).toEqual(before)
    }
  })

  test('a list nested three deep is past the limit', async () => {
    const w = await setup()
    let item: object = { type: 'paragraph', content: [text] }
    for (let i = 0; i < 3; i++)
      item = {
        type: 'bulletList',
        content: [{ type: 'listItem', content: [item] }],
      }
    expect(
      await errorCode(
        w.writer.mutation(api.write.saveDraft, {
          title: 'List',
          content: { type: 'doc', content: [item] },
        })
      )
    ).toBe('document-too-nested')
  })
})

describe('write.desk', () => {
  test('bounded, newest first, caller only, and no content leaves it', async () => {
    const w = await setup()
    for (let i = 0; i < 60; i++) {
      vi.advanceTimersByTime(1)
      await w.writer.mutation(api.write.saveDraft, {
        title: `Draft ${i}`,
        content: doc('', `Opening line of draft ${i}.`, 'More text here.'),
      })
    }
    await w.other.mutation(api.write.saveDraft, {
      title: 'Not yours',
      content: doc('Other words.'),
    })
    const desk = await w.writer.query(api.write.desk, {})
    expect(desk.drafts).toHaveLength(DESK_DEFAULT_LIMIT)
    expect(desk.drafts[0]).toMatchObject({
      title: 'Draft 59',
      firstLine: 'Opening line of draft 59.',
      words: 8,
    })
    const times = desk.drafts.map((d) => d.updatedAt)
    expect([...times].sort((a, b) => b - a)).toEqual(times)
    expect(desk.drafts.every((d) => d.title !== 'Not yours')).toBe(true)
    const json = JSON.stringify(desk)
    expect(json).not.toContain('"content"')
    expect(json).not.toContain('More text here')
    for (const d of desk.drafts)
      expect(Object.keys(d).sort()).toEqual([
        '_id',
        'firstLine',
        'title',
        'updatedAt',
        'words',
      ])
  })

  test('the limit is clamped to 1..7', async () => {
    const w = await setup()
    for (let i = 0; i < 12; i++)
      await w.writer.mutation(api.write.saveDraft, {
        title: `D${i}`,
        content: doc('x.'),
      })
    expect(
      (await w.writer.query(api.write.desk, { limit: 500 })).drafts
    ).toHaveLength(DESK_MAX_LIMIT)
    expect(
      (await w.writer.query(api.write.desk, { limit: 0 })).drafts
    ).toHaveLength(1)
    expect(
      (await w.writer.query(api.write.desk, { limit: 3.7 })).drafts
    ).toHaveLength(3)
  })

  test('at the largest document size the desk reads under 16 MiB', async () => {
    const w = await setup()
    // Close to the 1 MiB document limit: one long paragraph per article.
    const big = doc('x'.repeat(1_040_000))
    await w.t.run(async (ctx) => {
      for (let i = 0; i < 20; i++)
        await ctx.db.insert('articles', {
          title: `Big ${i}`,
          slug: `big-${i}`,
          content: big,
          authorId: w.ids.writer,
          authorUsername: 'ines',
          published: i % 2 === 0,
          publishedAt: i % 2 === 0 ? 1 : undefined,
          createdAt: 1,
          updatedAt: 10 + i,
        })
    })
    const desk = await w.writer.query(api.write.desk, { limit: 50 })
    expect(desk.drafts).toHaveLength(DESK_MAX_LIMIT)
    expect(desk.published).toHaveLength(DESK_MAX_LIMIT)
    // The documents those two lists read, measured as stored JSON.
    const read = await w.t.run(async (ctx) => {
      const rows = [
        ...(await ctx.db.query('articles').collect()).filter(
          (a) => a.authorId === w.ids.writer
        ),
      ]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .reduce(
          (acc, a) => {
            const list = a.published ? acc.published : acc.drafts
            if (list.length < DESK_MAX_LIMIT) list.push(a)
            return acc
          },
          { drafts: [] as unknown[], published: [] as unknown[] }
        )
      return [...rows.drafts, ...rows.published]
    })
    const bytes = read.reduce<number>(
      (sum, a) => sum + new TextEncoder().encode(JSON.stringify(a)).length,
      0
    )
    expect(bytes).toBeLessThan(16 * 1024 * 1024)
  })

  test('published rows list title, slug, handle and published time only', async () => {
    const w = await setup()
    const d = await w.writer.mutation(api.write.saveDraft, {
      title: 'Out',
      content: doc('Out.'),
    })
    await w.t.run((ctx) =>
      ctx.db.patch(d.id, { published: true, publishedAt: 77, slug: 'out' })
    )
    const desk = await w.writer.query(api.write.desk, {})
    expect(desk.drafts).toEqual([])
    expect(desk.published).toEqual([
      {
        _id: d.id,
        title: 'Out',
        slug: 'out',
        authorUsername: 'ines',
        publishedAt: 77,
      },
    ])
  })

  test('signed out gives empty lists', async () => {
    const w = await setup()
    await w.writer.mutation(api.write.saveDraft, {
      title: 'X',
      content: doc('Y.'),
    })
    expect(await w.t.query(api.write.desk, {})).toEqual({
      drafts: [],
      published: [],
    })
  })

  test('the first line is cut at 200 characters on a word', () => {
    const long = `${'word '.repeat(60)}end.`
    const line = firstLineOf(doc('', long))
    expect(line.length).toBeLessThanOrEqual(200)
    expect(long.startsWith(line)).toBe(true)
    expect(line.endsWith('word')).toBe(true)
    expect(firstLineOf(doc('', ''))).toBe('')
  })
})

describe('write.publish', () => {
  async function draft(
    w: World,
    content: unknown = doc('The ferry leaves at seven.')
  ) {
    const d = await w.writer.mutation(api.write.saveDraft, {
      title: 'The Ferry Timetable',
      content,
    })
    await w.t.run((ctx) =>
      ctx.db.patch(d.id, { excerpt: 'A morning crossing and its readers.' })
    )
    return { id: d.id, updatedAt: (await row(w, d.id))!.updatedAt }
  }

  test('a stale base is refused and nothing is published', async () => {
    const w = await setup()
    const d = await draft(w)
    expect(
      await errorCode(
        w.writer.mutation(api.write.publish, {
          id: d.id,
          baseUpdatedAt: d.updatedAt - 1,
        })
      )
    ).toBe('draft-changed')
    expect((await row(w, d.id))!.published).toBe(false)
  })

  test('another writer cannot publish the draft', async () => {
    const w = await setup()
    const d = await draft(w)
    expect(
      await errorCode(
        w.other.mutation(api.write.publish, {
          id: d.id,
          baseUpdatedAt: d.updatedAt,
        })
      )
    ).toBe('draft-not-found')
    expect((await row(w, d.id))!.published).toBe(false)
  })

  test('a clean document is published, with no permanent copy by default', async () => {
    const w = await setup()
    vi.stubEnv('ARWEAVE_ENABLED', 'true')
    vi.stubEnv('ARWEAVE_WALLET_KEY', '{"kty":"RSA"}')
    const d = await draft(w)
    const result = await w.writer.mutation(api.write.publish, {
      id: d.id,
      baseUpdatedAt: d.updatedAt,
    })
    expect(result).toMatchObject({ id: d.id, contentVersion: 1 })
    const published = (await row(w, d.id))!
    expect(published.published).toBe(true)
    expect(published.arweaveStatus).toBeUndefined()
    const scheduled = await w.t.run((ctx) =>
      ctx.db.system.query('_scheduled_functions').collect()
    )
    expect(scheduled.filter((s) => s.name.includes('arweave'))).toEqual([])
  })

  test('a republish checks the shares made before against the new text', async () => {
    const w = await setup()
    const first = await draft(w)
    await w.writer.mutation(api.write.publish, {
      id: first.id,
      baseUpdatedAt: first.updatedAt,
    })
    const none = await w.t.run((ctx) =>
      ctx.db.system.query('_scheduled_functions').collect()
    )
    // A first publish has no shares to check.
    expect(none.filter((s) => s.name.includes('shares'))).toEqual([])

    const d = await draft(w, doc('A line that was shared before.'))
    const shareId = await w.t.run(async (ctx) => {
      await ctx.db.patch(d.id, { content: doc('Rewritten since.') })
      return ctx.db.insert('shares', {
        code: 'abcdefgh',
        kind: 'canonical',
        articleId: d.id,
        passageId: 'p1',
        sentenceStart: 0,
        sentenceEnd: 0,
        quote: 'A line that was shared before.',
        contentVersion: 1,
        createdAt: 1,
        checkedAt: 1,
      })
    })
    await w.writer.mutation(api.write.publish, {
      id: d.id,
      baseUpdatedAt: (await row(w, d.id))!.updatedAt,
    })
    const scheduled = await w.t.run((ctx) =>
      ctx.db.system.query('_scheduled_functions').collect()
    )
    expect(
      scheduled.filter((s) => s.name.includes('shares:reconcileArticle'))
    ).toHaveLength(1)
    await w.t.finishAllScheduledFunctions(vi.runAllTimers)
    expect(await w.t.run((ctx) => ctx.db.get(shareId))).toMatchObject({
      quote: null,
      passageId: null,
    })
  })

  test('a permanent copy only when asked and storage is on', async () => {
    const w = await setup()
    const off = await draft(w)
    await w.writer.mutation(api.write.publish, {
      id: off.id,
      baseUpdatedAt: off.updatedAt,
      permanentCopy: true,
    })
    expect((await row(w, off.id))!.arweaveStatus).toBeUndefined()

    vi.stubEnv('ARWEAVE_ENABLED', 'true')
    vi.stubEnv('ARWEAVE_WALLET_KEY', '{"kty":"RSA"}')
    const on = await draft(w)
    await w.writer.mutation(api.write.publish, {
      id: on.id,
      baseUpdatedAt: on.updatedAt,
      permanentCopy: true,
    })
    expect((await row(w, on.id))!.arweaveStatus).toBe('pending')
    const scheduled = await w.t.run((ctx) =>
      ctx.db.system.query('_scheduled_functions').collect()
    )
    // Scheduled, never run: the uploader is mocked and timers are fake.
    expect(scheduled.filter((s) => s.name.includes('arweave'))).toHaveLength(1)
  })

  test('a document over the size limit is refused', async () => {
    const w = await setup()
    const d = await draft(w)
    await w.t.run((ctx) =>
      ctx.db.patch(d.id, { content: doc('x'.repeat(MAX_DOCUMENT_JSON_BYTES)) })
    )
    const base = (await row(w, d.id))!.updatedAt
    expect(
      await errorCode(
        w.writer.mutation(api.write.publish, { id: d.id, baseUpdatedAt: base })
      )
    ).toBe('document-too-large')
    expect((await row(w, d.id))!.published).toBe(false)
  })

  test('an already published article is refused', async () => {
    const w = await setup()
    const d = await draft(w)
    await w.writer.mutation(api.write.publish, {
      id: d.id,
      baseUpdatedAt: d.updatedAt,
    })
    const base = (await row(w, d.id))!.updatedAt
    expect(
      await errorCode(
        w.writer.mutation(api.write.publish, { id: d.id, baseUpdatedAt: base })
      )
    ).toBe('already-published')
  })
})

describe('the reading check (sanitiser seam)', () => {
  const sanitizer = (input: unknown) => {
    const d = structuredClone(input) as { content: Array<{ attrs?: unknown }> }
    if (JSON.stringify(input).includes('"too-many"')) {
      const error = new Error('too large')
      error.name = 'DocumentTooLarge'
      throw error
    }
    for (const node of d.content) delete node.attrs
    return d
  }

  test('a clean document passes', () => {
    expect(checkReadingDocument(doc('Clean.'), sanitizer)).toEqual({ ok: true })
  })

  test('an attribute outside the allowlist is not readable', () => {
    const dirty = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { onclick: 'x' },
          content: [{ type: 'text', text: 'Hi.' }],
        },
      ],
    }
    expect(checkReadingDocument(dirty, sanitizer)).toEqual({
      ok: false,
      code: 'document-not-readable',
    })
  })

  test('a document the sanitiser finds too large, or over 800 KB, is too large', () => {
    expect(checkReadingDocument(doc('too-many'), sanitizer)).toEqual({
      ok: false,
      code: 'document-too-large',
    })
    expect(
      checkReadingDocument(doc('x'.repeat(MAX_DOCUMENT_JSON_BYTES)), sanitizer)
    ).toEqual({ ok: false, code: 'document-too-large' })
  })

  test('with no sanitiser wired, only the size is checked', () => {
    expect(checkReadingDocument(doc('Hi.'), null)).toEqual({ ok: true })
  })
})

describe('review: forward-only updatedAt', () => {
  test('three saves in the same millisecond each move updatedAt forward', async () => {
    const w = await setup()
    // Fake timers: the clock does not move between these mutations.
    let last = await w.writer.mutation(api.write.saveDraft, {
      title: 'T',
      content: doc('One.'),
    })
    for (const text of ['Two.', 'Three.', 'Four.']) {
      const next = await w.writer.mutation(api.write.saveDraft, {
        id: last.id,
        baseUpdatedAt: last.updatedAt,
        title: 'T',
        content: doc(text),
      })
      expect(next.updatedAt).toBeGreaterThan(last.updatedAt)
      last = next
    }
  })

  test('an old-path save in the same millisecond still moves the base on', async () => {
    const w = await setup()
    const d = await w.writer.mutation(api.write.saveDraft, {
      title: 'Old path',
      content: doc('New editor words.'),
    })
    // Two old-path saves in a row: the harness clock stops moving, so only
    // the forward-only rule keeps each one after the last.
    let previous = d.updatedAt
    for (const text of ['Old editor words.', 'More old editor words.']) {
      await w.writer.mutation(api.articles.saveDraft, {
        id: d.id,
        title: 'Old path',
        content: doc(text),
      })
      const now = (await row(w, d.id))!.updatedAt
      expect(now).toBeGreaterThan(previous)
      previous = now
    }
    expect(
      await errorCode(
        w.writer.mutation(api.write.saveDraft, {
          id: d.id,
          baseUpdatedAt: d.updatedAt,
          title: 'Old path',
          content: doc('Would overwrite the old editor.'),
        })
      )
    ).toBe('draft-changed')
    // A stored time ahead of the clock never moves backwards.
    await w.t.run((ctx) =>
      ctx.db.patch(d.id, { updatedAt: Date.now() + 5_000 })
    )
    const ahead = (await row(w, d.id))!.updatedAt
    await w.writer.mutation(api.articles.updateArticle, {
      id: d.id,
      title: 'Old path again',
    })
    expect((await row(w, d.id))!.updatedAt).toBeGreaterThan(ahead)
  })
})

describe('review: content shape', () => {
  test('anything but a plain doc object is refused, typed, with nothing written', async () => {
    const w = await setup()
    const cases: Array<[unknown, string]> = [
      ['a string', 'not-a-doc'],
      [[{ type: 'doc' }], 'not-a-doc'],
      [null, 'not-a-doc'],
      [42, 'not-a-doc'],
      [{ type: 'paragraph', content: [] }, 'not-a-doc'],
      [new ArrayBuffer(900 * 1024), 'not-a-doc'],
      [
        { type: 'doc', content: [{ type: 'text', text: 'x', n: BigInt(1) }] },
        'value',
      ],
      [
        {
          type: 'doc',
          content: [{ type: 'image', bytes: new ArrayBuffer(8) }],
        },
        'value',
      ],
      [{ type: 'doc', content: [{ _id: 'x' }] }, 'key'],
      [
        {
          type: 'doc',
          content: Array.from({ length: MAX_ARRAY_ITEMS + 1 }, () => ({
            type: 'paragraph',
          })),
        },
        'array-too-long',
      ],
    ]
    for (const [content, reason] of cases) {
      const error = await errorData(
        w.writer.mutation(api.write.saveDraft, {
          title: 'Shape',
          content: content as never,
        })
      )
      expect(error, String(reason)).toMatchObject({
        code: 'document-invalid',
        reason,
      })
    }
    expect(await w.t.run((ctx) => ctx.db.query('articles').collect())).toEqual(
      []
    )
  })

  test('a $ field name never reaches the function: the arguments are refused', async () => {
    const w = await setup()
    await expect(
      w.writer.mutation(api.write.saveDraft, {
        title: 'Dollar',
        content: { type: 'doc', content: [{ $type: 'x' }] } as never,
      })
    ).rejects.toThrow(/starts with a '\$'/)
    expect(await w.t.run((ctx) => ctx.db.query('articles').collect())).toEqual(
      []
    )
  })

  test('an array of exactly the limit is stored', async () => {
    const w = await setup()
    const ok = await w.writer.mutation(api.write.saveDraft, {
      title: 'Wide',
      content: {
        type: 'doc',
        content: Array.from({ length: MAX_ARRAY_ITEMS }, () => ({
          type: 'paragraph',
        })),
      },
    })
    expect(ok.created).toBe(true)
  })
})

describe('review: device ids', () => {
  test('a known id whose draft was published is refused as a published save; the record stays', async () => {
    const w = await setup()
    const d = await w.writer.mutation(api.write.saveDraft, {
      clientId: CLIENT,
      title: 'Device draft',
      content: doc('Words.'),
    })
    await w.t.run((ctx) => ctx.db.patch(d.id, { published: true }))
    expect(
      await errorCode(
        w.writer.mutation(api.write.saveDraft, {
          clientId: CLIENT,
          title: 'Device draft',
          content: doc('Words, retried late.'),
        })
      )
    ).toBe('draft-published')
    const records = await w.t.run((ctx) =>
      ctx.db.query('draftClientIds').collect()
    )
    expect(records).toHaveLength(1)
    expect(
      await w.t.run((ctx) => ctx.db.query('articles').collect())
    ).toHaveLength(1)
  })

  test('deleting the draft deletes its id record; the id then makes a new draft', async () => {
    const w = await setup()
    const d = await w.writer.mutation(api.write.saveDraft, {
      clientId: CLIENT,
      title: 'Short lived',
      content: doc('Words.'),
    })
    await w.writer.mutation(api.articles.deleteArticle, { id: d.id })
    expect(
      await w.t.run((ctx) => ctx.db.query('draftClientIds').collect())
    ).toEqual([])
    const again = await w.writer.mutation(api.write.saveDraft, {
      clientId: CLIENT,
      title: 'Short lived',
      content: doc('Words kept.'),
    })
    expect(again.created).toBe(true)
    expect(again.id).not.toBe(d.id)
  })
})

describe('review: slugs', () => {
  test('three same-title creates in one millisecond get three slugs', async () => {
    const w = await setup()
    const ids = []
    for (let i = 0; i < 3; i++)
      ids.push(
        (
          await w.writer.mutation(api.write.saveDraft, {
            title: 'Same title',
            content: doc(`Copy ${i}.`),
          })
        ).id
      )
    const slugs = await Promise.all(
      ids.map(async (id) => (await row(w, id))!.slug)
    )
    expect(new Set(slugs).size).toBe(3)
    expect(slugs[0]).toBe('same-title')
  })

  test('a title change on a draft gives it the new title’s slug', async () => {
    const w = await setup()
    const d = await w.writer.mutation(api.write.saveDraft, {
      title: 'First title',
      content: doc('Words.'),
    })
    expect((await row(w, d.id))!.slug).toBe('first-title')
    await w.writer.mutation(api.write.saveDraft, {
      id: d.id,
      baseUpdatedAt: d.updatedAt,
      title: 'Second title',
      content: doc('Words.'),
    })
    expect((await row(w, d.id))!.slug).toBe('second-title')
  })
})

describe('review: publish rules and steps', () => {
  async function ready(
    w: World,
    title = 'The Ferry Timetable',
    body = 'The ferry leaves at seven.'
  ) {
    const d = await w.writer.mutation(api.write.saveDraft, {
      title,
      content: doc(body),
    })
    return { id: d.id, updatedAt: (await row(w, d.id))!.updatedAt }
  }
  const publishOf = (w: World, d: { id: Id<'articles'>; updatedAt: number }) =>
    w.writer.mutation(api.write.publish, {
      id: d.id,
      baseUpdatedAt: d.updatedAt,
    })

  test('each publish rule refuses with its own code and publishes nothing', async () => {
    const w = await setup()
    const short = await ready(w, 'Ab')
    expect(await errorData(publishOf(w, short))).toEqual({
      code: 'title-required',
      minLength: 3,
    })
    const placeholder = await ready(w, 'Untitled')
    expect(await errorCode(publishOf(w, placeholder))).toBe('title-required')
    const empty = await ready(w, 'An empty body', '')
    expect(await errorCode(publishOf(w, empty))).toBe('body-empty')
    const nameless = await ready(w, 'No handle here')
    await w.t.run((ctx) => ctx.db.patch(nameless.id, { authorUsername: ' ' }))
    expect(
      await errorCode(
        publishOf(w, { id: nameless.id, updatedAt: nameless.updatedAt })
      )
    ).toBe('username-required')
    const rows = await w.t.run((ctx) => ctx.db.query('articles').collect())
    expect(rows.every((a) => !a.published)).toBe(true)
  })

  test('no excerpt is needed: a draft without one publishes', async () => {
    const w = await setup()
    const d = await ready(w)
    expect((await row(w, d.id))!.excerpt).toBeUndefined()
    await publishOf(w, d)
    expect((await row(w, d.id))!.published).toBe(true)
  })

  test('publish counts the article, lists it, anchors its content and keeps search text', async () => {
    const w = await setup()
    const d = await ready(w, 'Harbour Lights', 'The lamps come on at dusk.')
    await w.t.run((ctx) =>
      ctx.db.patch(d.id, { excerpt: 'Notes from the pier', tags: ['Essays'] })
    )
    const base = (await row(w, d.id))!
    const expected = await w.t.run(async (ctx) =>
      publishContentAnchor((await ctx.db.get(d.id))!)
    )
    const result = await publishOf(w, { id: d.id, updatedAt: base.updatedAt })
    expect(result.contentHash).toBe(expected.contentHash)
    const other = await ready(
      w,
      'Harbour Lights Again',
      'Different words here.'
    )
    const second = await publishOf(w, other)
    expect(second.contentHash).not.toBe(result.contentHash)
    expect(
      (await w.t.run((ctx) => ctx.db.get(w.ids.writer)))!.articleCount
    ).toBe(2)
    const listed = await w.t.run((ctx) =>
      ctx.db
        .query('readingRoomArticles')
        .withIndex('by_article', (q) => q.eq('articleId', d.id))
        .unique()
    )
    expect(listed).toMatchObject({ title: 'Harbour Lights' })
    const published = (await row(w, d.id))!
    expect(published.searchContent).toContain('Notes from the pier')
    expect(published.searchContent).toContain('Essays')
    expect(published.searchContent).toContain('The lamps come on at dusk.')
  })

  test('a draft save keeps the stored excerpt and tags in the search text', async () => {
    const w = await setup()
    const d = await ready(w, 'Search Me')
    await w.t.run((ctx) =>
      ctx.db.patch(d.id, { excerpt: 'A stored excerpt', tags: ['Poems'] })
    )
    const base = (await row(w, d.id))!.updatedAt
    await w.writer.mutation(api.write.saveDraft, {
      id: d.id,
      baseUpdatedAt: base,
      title: 'Search Me',
      content: doc('Changed body words.'),
    })
    const saved = (await row(w, d.id))!
    expect(saved.searchContent).toContain('A stored excerpt')
    expect(saved.searchContent).toContain('Poems')
    expect(saved.searchContent).toContain('Changed body words.')
  })
})

describe('publishing without a receiving address', () => {
  /** One writer's publish, start to end, as the fields any article gets. */
  async function publishedState(verified: boolean) {
    const w = await setup()
    if (!verified)
      await w.t.run((ctx) =>
        ctx.db.patch(w.ids.writer, {
          stellarAddress: undefined,
          stellarAddressVerifiedAt: undefined,
          stellarAddressVerifiedNetwork: undefined,
        })
      )
    // A first publish, then a republish with a share made in between.
    const first = await w.writer.mutation(api.write.saveDraft, {
      title: 'Harbour Lights',
      content: doc('The lamps come on at dusk.'),
    })
    const anchor = await w.t.run(async (ctx) =>
      publishContentAnchor((await ctx.db.get(first.id))!)
    )
    const result = await w.writer.mutation(api.write.publish, {
      id: first.id,
      baseUpdatedAt: first.updatedAt,
    })
    const again = await w.writer.mutation(api.write.saveDraft, {
      title: 'Second article',
      content: doc('A line that was shared before.'),
    })
    await w.t.run(async (ctx) => {
      await ctx.db.patch(again.id, { content: doc('Rewritten since.') })
      await ctx.db.insert('shares', {
        code: 'abcdefgh',
        kind: 'canonical',
        articleId: again.id,
        passageId: 'p1',
        sentenceStart: 0,
        sentenceEnd: 0,
        quote: 'A line that was shared before.',
        contentVersion: 1,
        createdAt: 1,
        checkedAt: 1,
      })
    })
    await w.writer.mutation(api.write.publish, {
      id: again.id,
      baseUpdatedAt: (await row(w, again.id))!.updatedAt,
    })
    return w.t.run(async (ctx) => {
      const article = (await ctx.db.get(first.id))!
      const listed = await ctx.db
        .query('readingRoomArticles')
        .withIndex('by_article', (q) => q.eq('articleId', first.id))
        .unique()
      const scheduled = await ctx.db.system
        .query('_scheduled_functions')
        .collect()
      return {
        published: article.published,
        slug: article.slug,
        anchored:
          result.contentHash === anchor.contentHash &&
          article.contentHash === anchor.contentHash &&
          article.contentVersion === anchor.contentVersion,
        searchText: article.searchContent,
        listedTitle: listed?.title ?? null,
        articleCount: (await ctx.db.get(w.ids.writer))!.articleCount,
        shareReconciles: scheduled.filter((f) =>
          f.name.includes('shares:reconcileArticle')
        ).length,
      }
    })
  }

  test('a writer with no confirmed address publishes, and the article is treated as any other', async () => {
    const without = await publishedState(false)
    const withAddress = await publishedState(true)
    expect(without).toEqual(withAddress)
    expect(without).toMatchObject({
      published: true,
      anchored: true,
      listedTitle: 'Harbour Lights',
      articleCount: 2,
      shareReconciles: 1,
    })
    expect(without.searchText).toContain('The lamps come on at dusk.')
  })
})
