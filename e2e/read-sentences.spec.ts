import { expect, test } from '@playwright/test'
import { identityVectors as vectors } from '../lib/passages/vectors'

// The shared sentence vectors in the browser engine (e2e/fixtures/read/
// vectors.ts): the rule on each document, and the view's own path on the
// rendered HTML of each one-block case. Run in Chromium and WebKit by the
// read suite's config, so a difference between engines fails here.

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

test('a paragraph with a long run of combining marks still splits, quickly', async ({
  page,
}) => {
  // Such text is refused for sharing by the shared rule; reading and
  // choosing a line must still work, in this engine, without a stall.
  await page.goto('/vectors')
  await page.waitForFunction(() => typeof window.__timeSpans === 'function')
  for (const marks of [40, 10_000, 45_000]) {
    const result = await page.evaluate(
      (marks) =>
        window.__timeSpans(
          `Before. A${'\u0301'.repeat(marks)} word here. After.`
        ),
      marks
    )
    expect(result.count, `${marks} marks`).toBe(3)
    expect(result.ms, `${marks} marks`).toBeLessThan(250)
  }
})
