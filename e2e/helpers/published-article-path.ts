import { expect, type Page } from '@playwright/test'

export async function publishedArticlePath(page: Page): Promise<string | null> {
  const articleLink = page
    .getByRole('article')
    .first()
    .getByRole('link', { name: /^Read / })
    .first()
  const empty = page.getByRole('heading', {
    name: 'No articles here yet.',
    exact: true,
  })
  const failure = page.getByRole('heading', {
    name: 'Articles couldn’t load.',
    exact: true,
  })

  // Missing links alone can mean the Convex query is still loading or failed.
  await expect(
    articleLink.or(empty).or(failure).first(),
    'Articles must finish loading with a reading link or the empty state'
  ).toBeVisible()
  expect(await failure.isVisible(), 'Articles backend failed to load').toBe(
    false
  )
  if (await empty.isVisible()) return null

  await expect(articleLink).toBeVisible()
  const href = await articleLink.getAttribute('href')
  expect(href, 'Published article must link to a local reader route').toMatch(
    /^\/[^/?#]+\/[^/?#]+\/?$/
  )
  return href
}
