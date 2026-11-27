/**
 * The reader's spendable tab amount has one definition: `readerSpendable` in
 * `convex/lib/chain/tabLedger.ts`. The tab tip check and the read models
 * call it, so the screen and the acceptance rule cannot disagree. This
 * source check fails when other code combines `confirmedBalance` and
 * `outstanding` in one expression to derive the figure on its own.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..')
const SCANNED = ['convex', 'lib', 'components', 'app']
const SKIPPED = new Set(['_generated', 'node_modules'])

function sources(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIPPED.has(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sources(path))
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(path)
  }
  return out
}

/** Removes comments, so prose that names both fields is not a hit. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/**
 * Both fields in one expression with an arithmetic or comparison operator
 * between them. A `;`, `,`, `{` or `}` ends the expression, so an object
 * literal that lists the two fields side by side is not a hit.
 */
const DERIVED =
  /(confirmedBalance|outstanding)\b[^;,{}]{0,160}?[-+<>][^;,{}]{0,160}?\b(confirmedBalance|outstanding)\b/g

function derivations(text: string): string[] {
  const hits: string[] = []
  for (const m of code(text).matchAll(DERIVED)) {
    if (m[1] !== m[2]) hits.push(m[0].replace(/\s+/g, ' '))
  }
  return hits
}

describe('spendable tab amount', () => {
  it('is derived only by readerSpendable', () => {
    const found: string[] = []
    for (const dir of SCANNED) {
      for (const file of sources(join(ROOT, dir))) {
        for (const hit of derivations(readFileSync(file, 'utf8'))) {
          found.push(`${relative(ROOT, file)}: ${hit}`)
        }
      }
    }
    expect(found).toEqual([])
  })

  it('is what getMyTab shows and what the tab tip check uses', () => {
    const tabs = code(readFileSync(join(ROOT, 'convex/tabs.ts'), 'utf8'))
    expect(tabs).toMatch(
      /available:\s*readerSpendable\(account\)\.toString\(\)/
    )
    const ledger = code(
      readFileSync(join(ROOT, 'convex/lib/chain/tabLedger.ts'), 'utf8')
    )
    const check = ledger.slice(
      ledger.indexOf('export async function checkTabTip'),
      ledger.indexOf('TAB_OVER_BALANCE')
    )
    expect(check).toMatch(/args\.amount > readerSpendable\(account\)/)
  })

  it('catches the forms the check exists for', () => {
    expect(
      derivations(
        'available: (BigInt(a.confirmedBalance) - BigInt(a.outstanding)).toString(),'
      )
    ).toHaveLength(1)
    expect(
      derivations(
        'if (big(a.outstanding) + args.amount > big(a.confirmedBalance)) {'
      )
    ).toHaveLength(1)
    expect(
      derivations('confirmedBalance: a.confirmedBalance,\n  outstanding: x,')
    ).toEqual([])
    expect(derivations('// confirmedBalance - outstanding')).toEqual([])
  })
})
