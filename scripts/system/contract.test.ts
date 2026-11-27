import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// The contract for surface builders (system/README.md). Surfaces build on
// it, so an edit must never drop one of its sections.
const README = readFileSync(
  path.join(__dirname, '../../system/README.md'),
  'utf8'
)

const REQUIRED = [
  '## The structure (D20)',
  '### Interfaces the shell gives a surface',
  '### A saved setting',
  "### The tip control's props",
  '### Passage marks and reading',
  '## Where things live',
  '## What a surface may import',
  "## Shared lists: add your own file, never edit another's",
  '## Adding a surface',
  '## Public reading works with no script (D19)',
  '## Landmarks on a public page',
  '## Sheets, dialogs and focus',
  '## Money',
  '## States every surface handles',
  '## Naming',
  '## Checklist before a surface pull request',
]

describe('the contract for surface builders', () => {
  const headings = README.split('\n').filter((line) => /^#{2,3} /.test(line))

  it('keeps every required section', () => {
    expect(REQUIRED.filter((heading) => !headings.includes(heading))).toEqual(
      []
    )
  })

  it('keeps them in order', () => {
    const order = REQUIRED.map((heading) => headings.indexOf(heading))
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it('names every interface a surface relies on', () => {
    for (const name of [
      'registerSheet',
      'sheetStack.open',
      'openSignIn',
      'components/pocket/PocketContent.tsx',
      'PushedScreen',
      'PushedHeader',
      'useBalanceReading',
      'focusDestination',
      'useSwitchSetting',
      'shell/sheets/<package>.ts',
      'warmSheet',
      'withinReadLimit',
      'ReadingUnavailable',
      'KeepButton',
      'hold',
      'PassageMark',
      'lib/routing/redirects/<package>.ts',
      'scripts/rebuild/deleted/<package>.txt',
      'e2e/suites/<package>.ts',
      'scripts/perf/routes/<package>.ts',
    ])
      expect(README, name).toContain(name)
  })
})
