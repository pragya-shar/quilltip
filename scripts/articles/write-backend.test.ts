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
import {
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
          title: 'Taken',
          content: doc('Not yours.'),
        })
      )
    ).toBe('draft-not-found')
    await w.t.run((ctx) => ctx.db.delete(mine.id))
    expect(
      await errorCode(
        w.writer.mutation(api.write.saveDraft, {
          id: mine.id,
          title: 'Gone',
          content: doc('Gone.'),
        })
      )
    ).toBe('draft-not-found')
    expect(before!.title).toBe('Mine')
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

  test('a create returns { id, updatedAt }; an empty title is kept as a draft', async () => {
    const w = await setup()
    const d = await w.writer.mutation(api.write.saveDraft, {
      title: '',
      content: doc('Words before a title.'),
    })
    expect(Object.keys(d).sort()).toEqual(['id', 'updatedAt'])
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
    expect(again).toEqual(first)
    expect(await row(w, first.id)).toEqual(before)
    expect(
      await w.t.run((ctx) => ctx.db.query('articles').collect())
    ).toHaveLength(1)
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
    expect(desk.drafts).toHaveLength(20)
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

  test('the limit is clamped to 1..50', async () => {
    const w = await setup()
    for (let i = 0; i < 55; i++)
      await w.writer.mutation(api.write.saveDraft, {
        title: `D${i}`,
        content: doc('x.'),
      })
    expect(
      (await w.writer.query(api.write.desk, { limit: 500 })).drafts
    ).toHaveLength(50)
    expect(
      (await w.writer.query(api.write.desk, { limit: 0 })).drafts
    ).toHaveLength(1)
    expect(
      (await w.writer.query(api.write.desk, { limit: 3.7 })).drafts
    ).toHaveLength(3)
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
