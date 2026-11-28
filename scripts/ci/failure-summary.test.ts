import { describe, expect, it } from 'vitest'
import { parseErrorContext, summary } from './failure-summary'

const context = (name: string, error: string) => `# Instructions

- Following Playwright test failed.

# Test info

- Name: ${name}
- Location: e2e/system-shell.spec.ts:198:7

# Error details

\`\`\`
${error}
\`\`\`

# Page snapshot

\`\`\`yaml
- button "Close"
\`\`\`
`

describe('failure summary', () => {
  it('reads the name, location and error of a failed test', () => {
    expect(
      parseErrorContext(context('shell >> opens', 'Error: expected 1, got 0'))
    ).toEqual({
      name: 'shell >> opens',
      location: 'e2e/system-shell.spec.ts:198:7',
      error: 'Error: expected 1, got 0',
    })
    expect(parseErrorContext('no context')).toBeUndefined()
  })

  it('shows a test that failed on every retry once, with its last error', () => {
    const out = summary(
      ['first', 'second'].map(
        (e) => parseErrorContext(context('shell >> opens', e))!
      )
    )
    expect(out).toContain('Failed tests (1)')
    expect(out).toContain('second')
    expect(out).not.toContain('first')
  })

  it('says where to look when no test wrote a context', () => {
    expect(summary([])).toContain('the step log has the failure')
  })
})
