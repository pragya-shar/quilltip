import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { matches } from './plan'
import { STRING_CONSTRUCTS, STRING_INPUTS } from './string-inputs'

const root = path.join(__dirname, '../..')
const tracked = spawnSync('git', ['ls-files', '-z'], {
  cwd: root,
  encoding: 'utf8',
})
  .stdout.split('\0')
  .filter(Boolean)

describe('inputs named as strings', () => {
  // The planner scans every file in every filtered job's inputs. A construct
  // with no entry makes that job's inputs unknown; here it fails the build.
  it('has an entry for every file in a filtered job that names one', () => {
    const bun = process.env.npm_execpath?.includes('bun')
      ? process.env.npm_execpath
      : 'bun'
    const check = spawnSync(
      bun,
      ['scripts/ci/plan.ts', '--check-string-inputs'],
      {
        cwd: root,
        encoding: 'utf8',
      }
    )
    expect(check.stdout.trim(), check.stderr).toBe('')
    expect(check.status).toBe(0)
  }, 120_000)

  it('keeps no entry that matches no file with a construct', () => {
    for (const entry of STRING_INPUTS) {
      const named = tracked.filter(
        (file) =>
          matches(file, [entry.from]) &&
          STRING_CONSTRUCTS.test(readFileSync(path.join(root, file), 'utf8'))
      )
      expect(
        named.length,
        `The entry for "${entry.from}" in scripts/ci/string-inputs.ts matches no file that names an input: remove it.`
      ).toBeGreaterThan(0)
    }
  })

  it('finds each construct', () => {
    for (const text of [
      "import.meta.glob('../../convex/**/*.ts')",
      "setupFiles: ['x.ts']",
      "globalSetup: './g.ts'",
      'readdirSync(dir)',
      'await readFile(p)',
      'existsSync(p)',
    ]) {
      expect(STRING_CONSTRUCTS.test(text), text).toBe(true)
    }
    expect(STRING_CONSTRUCTS.test("import x from './x'")).toBe(false)
  })
})
