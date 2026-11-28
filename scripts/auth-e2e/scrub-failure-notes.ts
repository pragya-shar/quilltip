/**
 * Copies the sign-in suite's failure notes (each failed test's
 * error-context.md) to a separate folder for upload, without the run's
 * secrets:
 *
 *   bun scripts/auth-e2e/scrub-failure-notes.ts <output dir> <clean dir> <secrets file>
 *
 * A note holds the page snapshot, which lists the value of every input, a
 * password input too, and the error messages, which can quote a stored token.
 * The secrets are this run's own: run.ts writes the password and the signing
 * key to AUTH_E2E_SECRETS_FILE before the suite starts. Both are random per
 * run and exist only on the run's local anonymous backend.
 *
 * Nothing is cleaned in place. CI uploads only <clean dir>, and only when this
 * step succeeds, so a note this step did not prove clean never reaches the
 * upload: a note written after it, a note in another folder, or a note left
 * when this step fails.
 * - The output folder is walked without following links; only regular files
 *   named error-context.md are notes.
 * - Removed from each note: the password (also inside a longer string, as
 *   the wrong-password test types it), the signing key, any private key
 *   block and any string shaped like a JWT. The copy is written only when
 *   its own bytes hold none of them, and read back and checked again.
 * - Without a readable secrets file, no note is copied.
 * - Any error stops the step with a non-zero exit. The clean folder must be
 *   new or empty. The secrets file is deleted after it is read. Only counts
 *   are printed.
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { dirname, join, relative } from 'path'

export interface SuiteSecrets {
  password: string
  privateKey: string
}

const JWT = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g
const KEY_BLOCK =
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g
const KEY_FRAME = /-----(BEGIN|END) [A-Z ]*PRIVATE KEY-----/g

/** The secret strings to look for: each value, and the key's base64 lines. */
function secretStrings(secrets: SuiteSecrets): string[] {
  const keyBody = secrets.privateKey.replace(KEY_FRAME, '').replace(/\s+/g, '')
  // The spec breaks the key into 64-character lines; each line is a secret.
  const keyLines = keyBody.match(/.{1,64}/g) ?? []
  return [secrets.password, secrets.privateKey, keyBody, ...keyLines].filter(
    (value) => value.length >= 8
  )
}

export function scrubText(text: string, secrets: SuiteSecrets): string {
  let out = text.replace(KEY_BLOCK, '[private key]').replace(JWT, '[token]')
  for (const secret of secretStrings(secrets))
    out = out.replaceAll(secret, '[this run’s secret]')
  return out
}

export function isClean(text: string, secrets: SuiteSecrets): boolean {
  if (new RegExp(JWT.source).test(text)) return false
  if (new RegExp(KEY_FRAME.source).test(text)) return false
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

/** Regular files named error-context.md under `dir`; links are not followed. */
function findNotes(dir: string): string[] {
  const notes: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const stat = lstatSync(path)
    if (stat.isDirectory()) notes.push(...findNotes(path))
    else if (stat.isFile() && name === 'error-context.md') notes.push(path)
  }
  return notes
}

export function copyCleanNotes(
  outputDir: string,
  cleanDir: string,
  secrets: SuiteSecrets | null
): { copied: number; withheld: number } {
  if (existsSync(cleanDir) && readdirSync(cleanDir).length > 0)
    throw new Error(`The clean folder ${cleanDir} is not empty`)
  mkdirSync(cleanDir, { recursive: true })
  if (!existsSync(outputDir)) return { copied: 0, withheld: 0 }
  const notes = findNotes(outputDir)
  if (!secrets) return { copied: 0, withheld: notes.length }
  const counts = { copied: 0, withheld: 0 }
  for (const note of notes) {
    const copy = Buffer.from(scrubText(readFileSync(note, 'utf8'), secrets))
    if (!isClean(copy.toString('utf8'), secrets)) {
      counts.withheld += 1
      continue
    }
    const target = join(cleanDir, relative(outputDir, note))
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, copy, { flag: 'wx' })
    if (!isClean(readFileSync(target, 'utf8'), secrets)) {
      rmSync(target, { force: true })
      throw new Error('A copied note changed after it was checked')
    }
    counts.copied += 1
  }
  return counts
}

if (import.meta.main) {
  const [outputDir, cleanDir, secretsFile] = process.argv.slice(2)
  if (!outputDir || !cleanDir || !secretsFile) {
    console.error(
      'usage: bun scripts/auth-e2e/scrub-failure-notes.ts <output dir> <clean dir> <secrets file>'
    )
    process.exit(2)
  }
  const secrets = readSecrets(secretsFile)
  rmSync(secretsFile, { force: true })
  try {
    const { copied, withheld } = copyCleanNotes(outputDir, cleanDir, secrets)
    console.log(
      `Failure notes: ${copied} copied clean, ${withheld} withheld${secrets ? '' : ' (no readable secrets file)'}.`
    )
  } catch (error) {
    // The code alone: a message could quote a path or a value.
    const code = (error as NodeJS.ErrnoException).code ?? 'error'
    console.error(`Failure notes not copied (${code}); nothing is uploaded.`)
    process.exit(1)
  }
}
