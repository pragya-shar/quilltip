/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { expect, test } from 'vitest'
import schema from '../../convex/schema'
import { api, internal } from '../../convex/_generated/api'
import { handleFormatError } from '../../lib/profile/handleRules'

const modules = import.meta.glob('../../convex/**/*.ts')

async function setup() {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const writer = await ctx.db.insert('users', {
      email: 'writer@example.test',
      username: 'q6da1413b91a046bf95c',
      usernameLower: 'q6da1413b91a046bf95c',
      createdAt: 1,
      updatedAt: 1,
    })
    // An older account without usernameLower, matched exactly.
    const legacy = await ctx.db.insert('users', {
      email: 'anu@example.test',
      username: 'Anu',
      createdAt: 1,
      updatedAt: 1,
    })
    const other = await ctx.db.insert('users', {
      email: 'jess@example.test',
      username: 'Jess',
      usernameLower: 'jess',
      createdAt: 1,
      updatedAt: 1,
    })
    const article = await ctx.db.insert('articles', {
      title: 'Words to keep',
      slug: 'words-to-keep',
      content: {},
      authorId: writer,
      authorUsername: 'q6da1413b91a046bf95c',
      published: true,
      publishedAt: 1,
      createdAt: 1,
      updatedAt: 1,
    })
    return { writer, legacy, other, article }
  })
  const writer = t.withIdentity({ subject: `${ids.writer}|session` })
  const other = t.withIdentity({ subject: `${ids.other}|session` })
  return { t, ids, writer, other }
}

test.each([
  ['ab', 'Use 3 to 30 characters.'],
  ['a'.repeat(31), 'Use 3 to 30 characters.'],
  ['has space', 'Use letters, numbers and underscores only'],
  ['dash-name', 'Use letters, numbers and underscores only'],
  ['_leading', 'Use letters, numbers and underscores only'],
  ['articles', 'That handle is reserved.'],
  ['Admin', 'That handle is reserved.'],
])('handleFormatError(%s)', (handle, message) => {
  expect(handleFormatError(handle)).toContain(message)
})

test.each(['Pragya', 'pragya_s', 'Writer2026', 'abc'])(
  'handleFormatError allows %s',
  (handle) => {
    expect(handleFormatError(handle)).toBeNull()
  }
)

test('changing a handle requires sign-in', async () => {
  const { t } = await setup()
  await expect(
    t.mutation(api.handles.changeHandle, { handle: 'Pragya' })
  ).rejects.toThrow('Not authenticated')
})

test('handles are unique ignoring letter case, including older accounts', async () => {
  const { writer } = await setup()
  await expect(
    writer.mutation(api.handles.changeHandle, { handle: 'jess' })
  ).rejects.toThrow('That handle is taken.')
  await expect(
    writer.mutation(api.handles.changeHandle, { handle: 'Anu' })
  ).rejects.toThrow('That handle is taken.')
  expect(
    await writer.query(api.handles.checkHandle, { handle: 'JESS' })
  ).toEqual({
    status: 'taken',
  })
})

test('a change updates the account, its articles and keeps the old handle', async () => {
  const { t, ids, writer, other } = await setup()
  expect(
    await writer.query(api.handles.checkHandle, { handle: 'Pragya_S' })
  ).toEqual({ status: 'available' })
  expect(
    await writer.mutation(api.handles.changeHandle, { handle: ' Pragya_S ' })
  ).toEqual({ username: 'Pragya_S' })

  const state = await t.run(async (ctx) => ({
    user: await ctx.db.get(ids.writer),
    article: await ctx.db.get(ids.article),
    history: await ctx.db.query('usernameHistory').collect(),
  }))
  expect(state.user).toMatchObject({
    username: 'Pragya_S',
    usernameLower: 'pragya_s',
  })
  expect(state.article?.authorUsername).toBe('Pragya_S')
  expect(state.history).toMatchObject([
    { userId: ids.writer, username: 'q6da1413b91a046bf95c' },
  ])

  // The old handle stays with its writer and redirects.
  await expect(
    other.mutation(api.handles.changeHandle, { handle: 'q6da1413b91a046bf95c' })
  ).rejects.toThrow('That handle is taken.')
  expect(
    await t.query(api.publicRoutes.resolvePublicRoute, {
      username: 'q6da1413b91a046bf95c',
      slug: 'words-to-keep',
    })
  ).toEqual({ kind: 'moved', username: 'Pragya_S' })
})

test('writers can switch back to an earlier handle or change only its case', async () => {
  const { t, ids, writer } = await setup()
  await writer.mutation(api.handles.changeHandle, { handle: 'Pragya' })
  await writer.mutation(api.handles.changeHandle, {
    handle: 'q6da1413b91a046bf95c',
  })
  let history = await t.run((ctx) => ctx.db.query('usernameHistory').collect())
  expect(history.map((row) => row.username)).toEqual(['Pragya'])

  await writer.mutation(api.handles.changeHandle, { handle: 'pragya' })
  await writer.mutation(api.handles.changeHandle, { handle: 'PRAGYA' })
  history = await t.run((ctx) => ctx.db.query('usernameHistory').collect())
  // Case-only changes do not add history.
  expect(history.map((row) => row.username).sort()).toEqual([
    'q6da1413b91a046bf95c',
  ])
  expect(await t.run((ctx) => ctx.db.get(ids.writer))).toMatchObject({
    username: 'PRAGYA',
  })
})

test('writers keep at most five earlier handles', async () => {
  const { writer } = await setup()
  for (const handle of ['one1', 'two2', 'three3', 'four4', 'five5']) {
    await writer.mutation(api.handles.changeHandle, { handle })
  }
  await expect(
    writer.mutation(api.handles.changeHandle, { handle: 'six6' })
  ).rejects.toThrow('You can keep up to 5 earlier handles.')
  // Switching back to an earlier one is still allowed.
  expect(
    await writer.mutation(api.handles.changeHandle, { handle: 'one1' })
  ).toEqual({ username: 'one1' })
})

test('backfill reports accounts missing the lowercase copy and case collisions', async () => {
  const { t } = await setup()
  await t.run((ctx) =>
    ctx.db.insert('users', {
      email: 'anu2@example.test',
      username: 'anu',
      createdAt: 1,
      updatedAt: 1,
    })
  )
  const dry = await t.mutation(internal.handles.backfillUsernameLower, {
    dryRun: true,
  })
  expect(dry).toEqual({ total: 4, toUpdate: 2, collisions: [['Anu', 'anu']] })
  expect(
    await t.run(async (ctx) =>
      (await ctx.db.query('users').collect()).filter((u) => !u.usernameLower)
    )
  ).toHaveLength(2)

  await t.mutation(internal.handles.backfillUsernameLower, { dryRun: false })
  expect(
    await t.run(async (ctx) =>
      (await ctx.db.query('users').collect()).filter((u) => !u.usernameLower)
    )
  ).toHaveLength(0)
})
