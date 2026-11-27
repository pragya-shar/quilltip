import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'

// The shared sentence vectors in the browser engine (e2e/fixtures/read/
// vectors.ts): the rule on each document, and the view's own path on the
// rendered HTML of each one-block case. Run in Chromium and WebKit by the
// read suite's config, so a difference between engines fails here.

type Vector = {
  name: string
  sentences: { start: number; end: number; text: string }[]
}
const vectors = JSON.parse(
  readFileSync(
    path.join(__dirname, '../scripts/read/sentence-vectors-v1.json'),
    'utf8'
  )
) as { cases: Vector[] }

test('the sentence rule cuts every vector the same in this engine', async ({
  page,
}) => {
  await page.goto('/vectors')
  await page.waitForFunction(() => typeof window.__runVectors === 'function')
  const results = await page.evaluate(() => window.__runVectors())
  expect(results.map((r) => r.name)).toEqual(vectors.cases.map((v) => v.name))
  let viewed = 0
  for (const [index, vector] of vectors.cases.entries()) {
    const result = results[index]!
    expect(result.rule, `rule: ${vector.name}`).toEqual(vector.sentences)
    if (result.view === null) continue
    viewed++
    expect(result.view, `view: ${vector.name}`).toEqual(
      vector.sentences.map((s) => s.text)
    )
  }
  // Most cases are one block; the view's path ran on them.
  expect(viewed).toBeGreaterThan(vectors.cases.length / 2)
})
