import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

// The writers of the lifetime earnings totals (#552,
// convex/lib/lifetimeEarnings.ts). Each group of totals has one live writer;
// these checks keep any other code path from writing them.

const ROOT = path.resolve(__dirname, '../..')
const TAB_FIELDS = ['tabSettledBaseUnits', 'tabEarnedCents', 'tabTipCount']
const V1_FIELDS = [
  'v1TipCount',
  'v1EarnedCents',
  'v1ShareStroops',
  'v1UnpricedTipCount',
]

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      return entry.name === '_generated' ? [] : sourceFiles(full)
    }
    return entry.name.endsWith('.ts') ? [full] : []
  })
}

/** The code without comments, so that prose naming a field does not count. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const sources = sourceFiles(path.join(ROOT, 'convex')).map((file) => ({
  file: path.relative(ROOT, file),
  code: code(readFileSync(file, 'utf8')),
}))

function filesNaming(names: string[]): string[] {
  return sources
    .filter(({ code }) =>
      names.some((name) => new RegExp(`\\b${name}\\b`).test(code))
    )
    .map(({ file }) => file)
    .sort()
}

/** Files and enclosing functions that call `name(`, outside its definition. */
function callers(name: string): string[] {
  return sources.flatMap(({ file, code }) =>
    [...code.matchAll(new RegExp(`\\b${name}\\(`, 'g'))].flatMap((match) => {
      const before = code.slice(0, match.index)
      if (/function\s+$/.test(before)) return []
      // The enclosing named function or Convex function definition.
      const owner = [
        ...before.matchAll(
          /(?:function\s+(\w+)\s*\(|export const (\w+) = \w+\(\{)/g
        ),
      ].at(-1)
      return [`${file}:${owner?.[1] ?? owner?.[2]}`]
    })
  )
}

describe('lifetime totals writers (#552)', () => {
  test('only the lifetime totals modules name the tab totals and the v1 totals', () => {
    const owners = [
      'convex/lib/lifetimeEarnings.ts',
      'convex/lib/lifetimeTotalsFields.ts',
    ]
    expect(filesNaming(TAB_FIELDS)).toEqual(owners)
    expect(filesNaming(V1_FIELDS)).toEqual(owners)
  })

  test('the tab settlement is the only live writer of the tab totals', () => {
    expect(callers('creditTabTipTotals')).toEqual([
      'convex/lib/chain/tabLedger.ts:creditTabPaidRange',
    ])
    // Called once, where a pair's paid amount grows.
    expect(callers('creditTabPaidRange')).toEqual([
      'convex/lib/chain/tabLedger.ts:applyPairSettlement',
    ])
  })

  test('the v1 totals have no live writer: only the shared rule and the fields name them', () => {
    expect(
      filesNaming([
        'v1ShareStroops',
        'v1EarnedCents',
        'v1TipCount',
        'v1UnpricedTipCount',
      ])
    ).toEqual([
      'convex/lib/lifetimeEarnings.ts',
      'convex/lib/lifetimeTotalsFields.ts',
    ])
  })

  test('the wallet tip credit is the only live writer of the wallet XLM total', () => {
    const files = filesNaming(['walletEarnedBaseUnits'])
    expect(files).toEqual([
      'convex/lib/lifetimeEarnings.ts',
      'convex/lib/lifetimeTotalsFields.ts',
      'convex/lib/v2Earnings.ts',
    ])
  })
})
