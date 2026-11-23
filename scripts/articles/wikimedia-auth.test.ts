/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, expect, test, vi } from 'vitest'
import schema from '../../convex/schema'
import { api } from '../../convex/_generated/api'

const modules = import.meta.glob('../../convex/**/*.ts')
const filePage = 'https://commons.wikimedia.org/wiki/File:Example.jpg'

afterEach(() => vi.unstubAllGlobals())

async function setup() {
  const t = convexTest(schema, modules)
  const userId = await t.run((ctx) =>
    ctx.db.insert('users', {
      email: 'writer@example.test',
      username: 'writer',
      createdAt: 1,
      updatedAt: 1,
    })
  )
  return { t, writer: t.withIdentity({ subject: `${userId}|session` }) }
}

test('anonymous callers are refused before any Wikimedia request', async () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  const { t } = await setup()
  await expect(
    t.action(api.wikimedia.resolveWikimediaFileUrl, { pageUrl: filePage })
  ).rejects.toThrow('Not authenticated')
  expect(fetchMock).not.toHaveBeenCalled()
})

test('signed-in writers can still resolve links', async () => {
  const fetchMock = vi.fn(async () =>
    Response.json({
      query: {
        pages: {
          '1': {
            imageinfo: [
              {
                url: 'https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg',
              },
            ],
          },
        },
      },
    })
  )
  vi.stubGlobal('fetch', fetchMock)
  const { writer } = await setup()
  expect(
    await writer.action(api.wikimedia.resolveWikimediaFileUrl, {
      pageUrl: 'https://example.com/photo.jpg',
    })
  ).toEqual({ kind: 'not_file_page' })
  expect(
    await writer.action(api.wikimedia.resolveWikimediaFileUrl, {
      pageUrl: filePage,
    })
  ).toEqual({
    kind: 'ok',
    directUrl:
      'https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.jpg',
  })
})
