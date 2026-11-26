/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { expect, test } from 'vitest'
import schema from '../../convex/schema'
import { api } from '../../convex/_generated/api'
import {
  handleBaseFromName,
  isGeneratedHandle,
} from '../../lib/profile/handleRules'
import {
  profileBioError,
  profileNameError,
} from '../../lib/profile/profileRules'

const modules = import.meta.glob('../../convex/**/*.ts')

async function setup(name = 'Anaïs O’Neil') {
  const t = convexTest(schema, modules)
  const ids = await t.run(async (ctx) => {
    const writer = await ctx.db.insert('users', {
      email: 'new@example.test',
      name,
      username: 'q6da1413b91a046bf95c',
      usernameLower: 'q6da1413b91a046bf95c',
      bio: 'Old bio',
      createdAt: 1,
      updatedAt: 1,
    })
    const other = await ctx.db.insert('users', {
      email: 'taken@example.test',
      name: 'Someone else',
      username: 'anais_oneil',
      usernameLower: 'anais_oneil',
      createdAt: 1,
      updatedAt: 1,
    })
    return { writer, other }
  })
  const writer = t.withIdentity({ subject: `${ids.writer}|session` })
  return { t, ids, writer }
}

test('generated handles are recognised, chosen ones are not', () => {
  expect(isGeneratedHandle('q6da1413b91a046bf95c')).toBe(true)
  expect(isGeneratedHandle('Pragya')).toBe(false)
  expect(isGeneratedHandle('q6da1413b91a046bf95')).toBe(false)
})

test.each([
  ['Anaïs O’Neil', 'anais_oneil'],
  ['  Jess   Lee  ', 'jess_lee'],
  ['李', null],
  ['Al', null],
  ['A'.repeat(40), 'a'.repeat(28)],
])('handleBaseFromName(%s)', (name, base) => {
  expect(handleBaseFromName(name)).toBe(base)
})

test('profile field rules match the settings form', () => {
  expect(profileNameError('  ')).toBe('Enter the name readers will see.')
  expect(profileNameError('a'.repeat(51))).toBe(
    'Display name can be up to 50 characters.'
  )
  expect(profileNameError('Pragya')).toBeNull()
  expect(profileBioError('a'.repeat(501))).toBe(
    'Bio can be up to 500 characters.'
  )
  expect(profileBioError('a'.repeat(500))).toBeNull()
})

test('the suggestion skips taken handles and needs sign-in', async () => {
  const { t, writer } = await setup()
  await expect(t.query(api.handles.suggestHandle, {})).rejects.toThrow(
    'Not authenticated'
  )
  expect(await writer.query(api.handles.suggestHandle, {})).toEqual({
    handle: 'anais_oneil2',
  })
})

test('the suggestion is the current handle once the writer chose one', async () => {
  const { writer } = await setup()
  await writer.mutation(api.handles.changeHandle, { handle: 'Anais' })
  expect(await writer.query(api.handles.suggestHandle, {})).toEqual({
    handle: 'Anais',
  })
})

test('the suggestion is empty when the name has nothing usable', async () => {
  const { writer } = await setup('李')
  expect(await writer.query(api.handles.suggestHandle, {})).toEqual({
    handle: null,
  })
})

test('updateProfile saves a trimmed name and bio, and clears an empty bio', async () => {
  const { t, ids, writer } = await setup()
  await writer.mutation(api.users.updateProfile, {
    name: '  Anaïs  ',
    bio: '  Essays on paper.  ',
  })
  let user = await t.run((ctx) => ctx.db.get(ids.writer))
  expect(user).toMatchObject({ name: 'Anaïs', bio: 'Essays on paper.' })

  await writer.mutation(api.users.updateProfile, { bio: '   ' })
  user = await t.run((ctx) => ctx.db.get(ids.writer))
  expect(user?.bio).toBeUndefined()
  expect(user?.name).toBe('Anaïs')
})

test('updateProfile rejects invalid fields on the server', async () => {
  const { t, ids, writer } = await setup()
  await expect(
    writer.mutation(api.users.updateProfile, { name: ' ' })
  ).rejects.toThrow('Enter the name readers will see.')
  await expect(
    writer.mutation(api.users.updateProfile, { name: 'a'.repeat(51) })
  ).rejects.toThrow('Display name can be up to 50 characters.')
  await expect(
    writer.mutation(api.users.updateProfile, { bio: 'a'.repeat(501) })
  ).rejects.toThrow('Bio can be up to 500 characters.')
  await expect(
    t.mutation(api.users.updateProfile, { name: 'Intruder' })
  ).rejects.toThrow('Not authenticated')

  const user = await t.run((ctx) => ctx.db.get(ids.writer))
  expect(user).toMatchObject({ name: 'Anaïs O’Neil', bio: 'Old bio' })
})

test('updateProfile only changes the signed-in writer', async () => {
  const { t, ids, writer } = await setup()
  await writer.mutation(api.users.updateProfile, { name: 'Mine' })
  const other = await t.run((ctx) => ctx.db.get(ids.other))
  expect(other?.name).toBe('Someone else')
})

test('completing setup marks only the signed-in writer', async () => {
  const { t, ids, writer } = await setup()
  await expect(t.mutation(api.users.completeOnboarding, {})).rejects.toThrow(
    'Not authenticated'
  )
  await writer.mutation(api.users.completeOnboarding, {})
  const [mine, other] = await t.run(async (ctx) => [
    await ctx.db.get(ids.writer),
    await ctx.db.get(ids.other),
  ])
  expect(mine?.onboardingCompleted).toBe(true)
  expect(other?.onboardingCompleted).toBeUndefined()
  expect(await writer.query(api.users.getCurrentUser, {})).toMatchObject({
    onboardingCompleted: true,
  })
})

test('the welcome route is reserved as a handle', async () => {
  const { writer } = await setup()
  expect(
    await writer.query(api.handles.checkHandle, { handle: 'Welcome' })
  ).toEqual({ status: 'invalid', message: 'That handle is reserved.' })
})
