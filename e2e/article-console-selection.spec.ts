import { test, expect } from '@playwright/test'
import { publishedArticlePath } from './helpers/published-article-path'

const empty = '<h2>No articles here yet.</h2>'
const populated =
  '<article><a href="/writer/published-article">Read more</a></article>'

test('a loaded empty list returns no reader path', async ({ page }) => {
  await page.setContent(empty)
  expect(await publishedArticlePath(page)).toBeNull()
})

test('a populated list resolves its reading link', async ({ page }) => {
  await page.setContent(populated)
  expect(await publishedArticlePath(page)).toBe('/writer/published-article')
})

for (const [state, content, expected] of [
  ['empty', empty, null],
  ['populated', populated, '/writer/published-article'],
] as const) {
  test(`loading waits for the ${state} result`, async ({ page }) => {
    await page.setContent('<div role="status">Loading articles…</div>')
    let settled = false
    const selection = publishedArticlePath(page).finally(() => {
      settled = true
    })
    await expect(page.getByRole('status')).toBeVisible()
    expect(settled).toBe(false)
    await page.setContent(content)
    expect(await selection).toBe(expected)
  })
}

test('unresolved loading fails instead of returning an empty result', async ({
  page,
}) => {
  await page.setContent('<div role="status">Loading articles…</div>')
  await expect(publishedArticlePath(page)).rejects.toThrow(
    'Articles must finish loading with a reading link or the empty state'
  )
})

test('backend failure fails instead of returning an empty result', async ({
  page,
}) => {
  await page.setContent('<h1>Articles couldn’t load.</h1>')
  await expect(publishedArticlePath(page)).rejects.toThrow(
    'Articles backend failed to load'
  )
})

test('a malformed reading link fails instead of skipping', async ({ page }) => {
  await page.setContent('<article><a href="/articles">Read more</a></article>')
  await expect(publishedArticlePath(page)).rejects.toThrow(
    'Published article must link to a local reader route'
  )
})
