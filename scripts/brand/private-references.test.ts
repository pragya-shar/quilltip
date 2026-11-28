import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// The repository is public. Code, comments, tests and docs give reasons in
// plain words ("public pages must render without scripts"), never by
// pointing at private planning records: a decision number, the design
// document, the planning document or one of its rule numbers.

const root = path.resolve(__dirname, '../..')
const self = path.relative(root, __filename)

/** Anywhere in a file. */
const ANYWHERE = [
  /DESIGN-ZERO/,
  /\bdesign-zero\b/i,
  /\brebuild plan\b/i,
  /\brule R[0-9]+\b/,
  /\bdecision D[0-9]{1,2}\b/i,
  /\bdesign N[0-9]\b/i,
  /\bthe plan's\b/i,
  /\bplan (?:section )?[0-9]+\.[0-9]+/i,
]

/** In a comment line, or anywhere in Markdown: "(D19)", "D21 requires". */
const DECISION = /\bD[0-9]{1,2}\b/
const COMMENT = /^\s*(\/\/|\/\*|\*|#|\{\/\*)/

const BINARY = /\.(woff2?|ttf|otf|png|jpe?g|webp|gif|ico|wasm|svg|lock|pdf)$/

export function privateReferences(
  file: string,
  text: string
): { line: number; text: string }[] {
  const markdown = file.endsWith('.md')
  const found: { line: number; text: string }[] = []
  text.split('\n').forEach((line, index) => {
    const hit =
      ANYWHERE.some((pattern) => pattern.test(line)) ||
      ((markdown || COMMENT.test(line)) && DECISION.test(line))
    if (hit) found.push({ line: index + 1, text: line.trim().slice(0, 120) })
  })
  return found
}

describe('no references to private planning records', () => {
  it('finds none in tracked files', () => {
    const files = execFileSync('git', ['ls-files'], { cwd: root })
      .toString()
      .split('\n')
      .filter((file) => file && file !== self && !BINARY.test(file))
    const hits: string[] = []
    for (const file of files) {
      let text: string
      try {
        text = readFileSync(path.join(root, file), 'utf8')
      } catch {
        continue
      }
      for (const hit of privateReferences(file, text))
        hits.push(`${file}:${hit.line}: ${hit.text}`)
    }
    expect(hits).toEqual([])
  })

  it('catches each pattern, and leaves code and table ids alone', () => {
    expect(privateReferences('a.ts', '// public reading (D19)')).toHaveLength(1)
    expect(privateReferences('a.ts', ' * see DESIGN-ZERO 3.2')).toHaveLength(1)
    expect(
      privateReferences('a.ts', 'const x = 1 // rebuild plan 5.3')
    ).toHaveLength(1)
    expect(privateReferences('a.md', 'Required by D21.')).toHaveLength(1)
    expect(
      privateReferences('a.ts', "// the plan's public-route limits")
    ).toHaveLength(1)
    expect(privateReferences('a.ts', '// see plan 4.1')).toHaveLength(1)
    expect(privateReferences('a.ts', 'const R1 = articleRef()')).toEqual([])
    expect(privateReferences('a.tsx', '<path d="M29 17h49v7H29Z" />')).toEqual(
      []
    )
    expect(privateReferences('a.md', '| N1 not eligible state |')).toEqual([])
  })
})
