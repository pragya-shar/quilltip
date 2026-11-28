import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { matches } from './plan'
import { STRING_INPUTS, constructCount } from './string-inputs'

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

  it('keeps no entry that matches no tracked file', () => {
    for (const entry of STRING_INPUTS) {
      const named = tracked.filter((file) => matches(file, [entry.from]))
      expect(
        named.length,
        `The entry for "${entry.from}" in scripts/ci/string-inputs.ts matches no file: remove it.`
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
      'await readdir(dir)',
      'lstatSync(p)',
      'accessSync(p)',
      'globSync("x/**")',
      'Bun.file(p)',
      'new Bun.Glob(p)',
      "new URL('./x.json', import.meta.url)",
      'await import(`./${name}.ts`)',
      "spawnSync('docker', [])",
    ]) {
      expect(constructCount(text), text).toBe(1)
    }
    expect(constructCount("import x from './x'")).toBe(0)
    expect(constructCount("new URL('https://example.com')")).toBe(0)
    expect(constructCount('/a/.exec(b)')).toBe(0)
  })
})
