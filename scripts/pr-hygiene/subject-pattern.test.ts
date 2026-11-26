import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// The PR Hygiene workflow checks PR titles and commit subjects with
// `grep -E` and this pattern, so the tests use grep too.
const pattern = readFileSync(
  path.join(import.meta.dirname, 'subject-pattern.txt'),
  'utf8'
).trimEnd()

function accepts(subject: string): boolean {
  try {
    execFileSync('grep', ['-Eq', pattern], { input: `${subject}\n` })
    return true
  } catch {
    return false
  }
}

describe('commit subject pattern', () => {
  it.each([
    'feat(profile): add profile settings',
    'fix: restore draft focus',
    'feat(navigation): use one header on every page #408',
    'perf(profile): render writer pages on the server (#416)',
    'feat(profile): add a setup screen for new writers (#407, #409)',
    'fix(tips): count verified tips only (#405, #428, #431)',
  ])('accepts %s', (subject) => {
    expect(accepts(subject)).toBe(true)
  })

  it.each([
    [
      'a list without a space after the comma',
      'feat(profile): add settings (#407,#409)',
    ],
    [
      'a list with a trailing comma',
      'feat(profile): add settings (#407, #409,)',
    ],
    ['a non-numeric reference', 'feat(profile): add settings (#407, #abc)'],
    ['a non-numeric single reference', 'feat(profile): add settings (#abc)'],
    ['an unknown type', 'feature(profile): add settings (#407)'],
    ['a missing description', 'feat(profile): (#407, #409)'],
  ])('rejects %s', (_case, subject) => {
    expect(accepts(subject)).toBe(false)
  })
})
