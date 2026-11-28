/**
 * Prints the failed Playwright tests of this checkout as Markdown, for a CI
 * job summary: each test's name, location and error, from the
 * `error-context.md` files Playwright writes into `test-results/`. A test
 * that failed on every retry appears once, with its last error.
 *
 *   bun scripts/ci/failure-summary.ts >>"$GITHUB_STEP_SUMMARY"
 */
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const MAX_ERROR_LINES = 30
const MAX_BYTES = 60_000

export type Failure = { name: string; location: string; error: string }

/** Name, location and error details of one `error-context.md`. */
export function parseErrorContext(text: string): Failure | undefined {
  const name = text.match(/^- Name: (.*)$/m)?.[1]
  const location = text.match(/^- Location: (.*)$/m)?.[1]
  if (!name || !location) return undefined
  const details = text.split(/^# Error details$/m)[1]?.split(/^# /m)[0] ?? ''
  const block = details.match(/```\n([\s\S]*?)\n```/)?.[1] ?? ''
  const lines = block.split('\n')
  const error =
    lines.length > MAX_ERROR_LINES
      ? [...lines.slice(0, MAX_ERROR_LINES), '…'].join('\n')
      : block
  return { name, location, error }
}

/** The summary for a list of failures, newest file last; at most `MAX_BYTES`. */
export function summary(failures: readonly Failure[]): string {
  const byTest = new Map<string, Failure>()
  for (const failure of failures)
    byTest.set(`${failure.location} ${failure.name}`, failure)
  if (byTest.size === 0) {
    return '### Failed tests\n\nNo Playwright error context was written; the step log has the failure.\n'
  }
  let out = `### Failed tests (${byTest.size})\n\nTraces and page snapshots are in this job's artifact.\n`
  for (const f of byTest.values()) {
    const entry = `\n**${f.name}**  \n\`${f.location}\`\n\n\`\`\`\n${f.error}\n\`\`\`\n`
    if (out.length + entry.length > MAX_BYTES) {
      out += '\nMore failures are in the artifact.\n'
      break
    }
    out += entry
  }
  return out
}

function main(): void {
  const root = process.cwd()
  // Playwright writes test-results/ next to the config: the root's, or one
  // under e2e/.
  const files = [
    'test-results/**/error-context.md',
    'e2e/**/test-results/**/error-context.md',
  ]
    .flatMap((pattern) => [...new Bun.Glob(pattern).scanSync({ cwd: root })])
    .map((file) => path.join(root, file))
    .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs)
  const failures = files
    .map((file) => parseErrorContext(readFileSync(file, 'utf8')))
    .filter((f): f is Failure => f !== undefined)
  process.stdout.write(summary(failures))
}

if (import.meta.main) main()
