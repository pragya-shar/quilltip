import { execFileSync } from 'child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { CHECK_FAILURE_HINT, loadAllowlist, run } from './apply-spelling'
import {
  applySpelling,
  findOccurrences,
  looksBinary,
  validateAllowlist,
  type AllowEntry,
} from './spelling'

const repoRoot = resolve(__dirname, '../..')

describe('applySpelling', () => {
  it('rewrites both old spellings, including possessives and identifiers', () => {
    const { text, changed } = applySpelling(
      'a.tsx',
      "QuillTip’s home. New to Quill Tip?\nconst QuillTipTheme = 'QuillTip UI'",
      []
    )
    expect(text).toBe(
      "Quilltip’s home. New to Quilltip?\nconst QuilltipTheme = 'Quilltip UI'"
    )
    expect(changed.map((o) => [o.line, o.column, o.from])).toEqual([
      [1, 1, 'QuillTip'],
      [1, 25, 'Quill Tip'],
      [2, 7, 'QuillTip'],
      [2, 24, 'QuillTip'],
    ])
  })

  it('rewrites the text after the drawn Q of the wordmark', () => {
    const { text, changed } = applySpelling(
      'a.tsx',
      '<svg aria-hidden="true"></svg><span aria-hidden="true">uillTip</span>',
      []
    )
    expect(text).toBe(
      '<svg aria-hidden="true"></svg><span aria-hidden="true">uilltip</span>'
    )
    expect(changed).toHaveLength(1)
    // Inside the full name, only the full-name rule applies.
    expect(applySpelling('a.html', '<b>QuillTip</b>', []).text).toBe(
      '<b>Quilltip</b>'
    )
  })

  it('leaves the new spelling, all capitals, lower case and env names alone', () => {
    const input =
      'Quilltip QUILLTIP quilltip.app QUILLTIP_NETWORK_GUARD_OPT_IN quill tip'
    expect(applySpelling('a.md', input, []).changed).toEqual([])
  })

  it('is idempotent', () => {
    const once = applySpelling('a.md', 'QuillTip and QuillTip', []).text
    const twice = applySpelling('a.md', once, [])
    expect(twice.text).toBe(once)
    expect(twice.changed).toEqual([])
  })

  it('keeps an occurrence inside an allowlist match, and only that one', () => {
    const allow: AllowEntry[] = [
      { class: 'C', match: 'QuillTip Article', reason: 'on-chain name kept' },
    ]
    const { text, kept } = applySpelling(
      'lib/nft.ts',
      'name: `QuillTip Article #1`, description: `Not on QuillTip.`',
      allow
    )
    expect(text).toBe(
      'name: `QuillTip Article #1`, description: `Not on Quilltip.`'
    )
    expect(kept).toHaveLength(1)
    expect(kept[0]!.keptBy).toBe(allow[0])
  })

  it('scopes an entry to its file or directory', () => {
    const allow: AllowEntry[] = [
      { class: 'D', path: 'docs/spec/', reason: 'owned elsewhere' },
      {
        class: 'C',
        path: 'lib/memo.ts',
        match: "'QuillTip memo'",
        reason: 'signed memo kept',
      },
    ]
    expect(
      findOccurrences('docs/spec/a.md', 'QuillTip', allow)[0]!.keptBy?.class
    ).toBe('D')
    expect(
      findOccurrences('docs/specs.md', 'QuillTip', allow)[0]!.keptBy
    ).toBeUndefined()
    expect(
      findOccurrences('lib/memo.ts', "x('QuillTip memo')", allow)[0]!.keptBy
        ?.class
    ).toBe('C')
    expect(
      findOccurrences('lib/other.ts', "x('QuillTip memo')", allow)[0]!.keptBy
    ).toBeUndefined()
  })

  it('needs the whole occurrence inside the match', () => {
    const allow: AllowEntry[] = [
      { class: 'C', match: 'Quill', reason: 'too short to cover the name' },
    ]
    expect(
      findOccurrences('a.md', 'QuillTip', allow)[0]!.keptBy
    ).toBeUndefined()
  })

  it('keeps line endings', () => {
    expect(applySpelling('a.md', 'QuillTip\r\nx\r\n', []).text).toBe(
      'Quilltip\r\nx\r\n'
    )
  })
})

describe('validateAllowlist', () => {
  it('accepts the repository allowlist', () => {
    const entries = loadAllowlist(repoRoot)
    expect(entries.length).toBeGreaterThan(0)
  })

  it('points every class E entry at an existing file', () => {
    for (const entry of loadAllowlist(repoRoot).filter((e) => e.class === 'E'))
      expect(existsSync(join(repoRoot, entry.path!)), entry.path).toBe(true)
  })

  it.each([
    [{}, /needs a class/],
    [{ class: 'Z', path: 'a', reason: 'some reason here' }, /needs a class/],
    [{ class: 'C', path: 'a' }, /needs a reason/],
    [{ class: 'C', path: 'a', reason: 'short' }, /needs a reason/],
    [{ class: 'C', reason: 'a long enough reason' }, /path, a match or both/],
    [{ class: 'C', path: '/abs', reason: 'a long enough reason' }, /relative/],
    [{ class: 'C', match: '', reason: 'a long enough reason' }, /empty match/],
    [
      { class: 'C', path: 'a', reason: 'a long enough reason', extra: 1 },
      /unknown key/,
    ],
  ])('rejects %j', (entry, message) => {
    expect(() => validateAllowlist([entry])).toThrow(message)
  })
})

describe('looksBinary', () => {
  it('detects a NUL byte', () => {
    expect(looksBinary(new Uint8Array([0x89, 0x50, 0x00, 0x47]))).toBe(true)
    expect(looksBinary(new TextEncoder().encode('QuillTip'))).toBe(false)
  })
})

describe('run', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0))
      rmSync(dir, { recursive: true, force: true })
  })

  function repo(files: Record<string, string | Uint8Array>) {
    const root = mkdtempSync(join(tmpdir(), 'brand-spelling-'))
    dirs.push(root)
    execFileSync('git', ['init', '-q'], { cwd: root })
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true })
      writeFileSync(join(root, path), content)
    }
    writeFileSync(join(root, '.gitignore'), 'ignored/\n')
    execFileSync('git', ['add', '.'], { cwd: root })
    return root
  }

  const allowlist = JSON.stringify([
    { class: 'D', path: 'owned/', reason: 'owned by another team' },
    {
      class: 'C',
      path: 'lib/challenge.ts',
      match: 'QuillTip asks you',
      reason: 'signed challenge text',
    },
    { class: 'C', match: 'never present', reason: 'an unused entry here' },
  ])

  function fixture() {
    return repo({
      'scripts/brand/allowlist.json': allowlist,
      'README.md': '# QuillTip\n',
      'lib/challenge.ts': "'QuillTip asks you to sign.' // QuillTip user\n",
      'owned/a.rs': 'QuillTip\n',
      'image.png': new Uint8Array([0x89, 0x00, ...Buffer.from('QuillTip')]),
      'ignored/a.md': 'QuillTip\n',
    })
  }

  it('fails the check, names each place and says how to fix it', () => {
    const root = fixture()
    // A new file Git does not ignore yet is checked too.
    writeFileSync(join(root, 'new.md'), 'Quill Tip\n')
    const lines: string[] = []
    const result = run({ root, check: true, log: (l) => lines.push(l) })
    expect(result.ok).toBe(false)
    expect(
      result.changed.map((o) => `${o.path}:${o.line}:${o.column}`)
    ).toEqual(['README.md:1:3', 'lib/challenge.ts:1:33', 'new.md:1:1'])
    expect(lines.join('\n')).toContain(CHECK_FAILURE_HINT)
    expect(lines.join('\n')).toContain('bun run brand:apply')
    // The check writes nothing.
    expect(readFileSync(join(root, 'README.md'), 'utf8')).toBe('# QuillTip\n')
  })

  it('applies, then the check passes and a second run changes nothing', () => {
    const root = fixture()
    const first = run({ root, check: false, log: () => {} })
    expect(first.files).toEqual(['README.md', 'lib/challenge.ts'])
    expect(readFileSync(join(root, 'README.md'), 'utf8')).toBe('# Quilltip\n')
    expect(readFileSync(join(root, 'lib/challenge.ts'), 'utf8')).toBe(
      "'QuillTip asks you to sign.' // Quilltip user\n"
    )
    expect(readFileSync(join(root, 'owned/a.rs'), 'utf8')).toBe('QuillTip\n')
    expect(readFileSync(join(root, 'ignored/a.md'), 'utf8')).toBe('QuillTip\n')
    expect(first.unused.map((e) => e.match)).toEqual(['never present'])

    const second = run({ root, check: false, log: () => {} })
    expect(second.changed).toEqual([])
    expect(run({ root, check: true, log: () => {} }).ok).toBe(true)
  })
})

describe('the repository', () => {
  it('has no old spelling outside the allowlist', () => {
    const result = run({ root: repoRoot, check: true, log: () => {} })
    expect(
      result.changed.map((o) => `${o.path}:${o.line}`),
      CHECK_FAILURE_HINT
    ).toEqual([])
  })
})
