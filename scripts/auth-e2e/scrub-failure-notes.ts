/**
 * Removes the sign-in suite's secrets from the failure notes Playwright
 * writes (each failed test's error-context.md under test-results), before
 * CI uploads them:
 *
 *   bun scripts/auth-e2e/scrub-failure-notes.ts <results dir> <secrets file>
 *
 * A note holds the page snapshot, which lists the value of every input, a
 * password input too, and the error messages, which can quote a stored token.
 * The secrets are this run's own: run.ts writes the password and the signing
 * key to AUTH_E2E_SECRETS_FILE before the suite starts. Both are random per
 * run and exist only on the run's local anonymous backend.
 *
 * Removed: the password (also inside a longer string, as the wrong-password
 * test types it), the signing key, any private key block and any string
 * shaped like a JWT. A note that cannot be proved clean is deleted: when the
 * secrets file is missing or unreadable, or a secret remains after the scrub.
 * The secrets file is deleted after it is read. Only counts are printed.
 */
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { join } from 'path'

export interface SuiteSecrets {
  password: string
  privateKey: string
}

const JWT = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g
const KEY_BLOCK =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g

/** The secret strings to look for: each value, and the key without its frame. */
function secretStrings(secrets: SuiteSecrets): string[] {
  const keyBody = secrets.privateKey
    .replace(/-----(BEGIN|END) [A-Z ]*PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '')
  return [secrets.password, secrets.privateKey, keyBody].filter(
    (value) => value.length >= 8
  )
}

export function scrubText(text: string, secrets: SuiteSecrets): string {
  let out = text.replace(KEY_BLOCK, '[private key]').replace(JWT, '[token]')
  for (const secret of secretStrings(secrets))
    out = out.replaceAll(secret, '[this run’s secret]')
  return out
}

function isClean(text: string, secrets: SuiteSecrets): boolean {
  if (new RegExp(JWT.source).test(text)) return false
  if (new RegExp(KEY_BLOCK.source).test(text)) return false
  return secretStrings(secrets).every((secret) => !text.includes(secret))
}

/** The secrets run.ts wrote, or null when they cannot be read. */
export function readSecrets(file: string): SuiteSecrets | null {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as SuiteSecrets
    if (typeof parsed.password !== 'string' || parsed.password.length < 8)
      return null
    if (typeof parsed.privateKey !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

export function scrubFailureNotes(
  dir: string,
  secrets: SuiteSecrets | null
): { scrubbed: number; deleted: number } {
  const counts = { scrubbed: 0, deleted: 0 }
  if (!existsSync(dir)) return counts
  const files = readdirSync(dir, { recursive: true, encoding: 'utf8' })
  for (const file of files) {
    if (!file.endsWith('error-context.md')) continue
    const path = join(dir, file)
    const text = secrets ? scrubText(readFileSync(path, 'utf8'), secrets) : ''
    if (!secrets || !isClean(text, secrets)) {
      rmSync(path, { force: true })
      counts.deleted += 1
      continue
    }
    writeFileSync(path, text)
    counts.scrubbed += 1
  }
  return counts
}

if (import.meta.main) {
  const [dir, secretsFile] = process.argv.slice(2)
  if (!dir || !secretsFile) {
    console.error(
      'usage: bun scripts/auth-e2e/scrub-failure-notes.ts <results dir> <secrets file>'
    )
    process.exit(2)
  }
  const secrets = readSecrets(secretsFile)
  rmSync(secretsFile, { force: true })
  const { scrubbed, deleted } = scrubFailureNotes(dir, secrets)
  console.log(
    `Failure notes: ${scrubbed} scrubbed, ${deleted} deleted${secrets ? '' : ' (no readable secrets file)'}.`
  )
}
