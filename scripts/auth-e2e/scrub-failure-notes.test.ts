import { afterEach, expect, test } from 'vitest'
import { spawn, spawnSync } from 'child_process'
import { randomBytes } from 'crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join, relative } from 'path'
import { copyCleanNotes, type SuiteSecrets } from './scrub-failure-notes'

/**
 * CI uploads the sign-in suite's failure notes only from the folder this
 * step fills (scrub-failure-notes.ts), and only when the step succeeds. These
 * tests read "the upload" as CI does: the error-context.md files in the clean
 * folder after an exit code 0, and nothing otherwise.
 */

const SCRIPT = join(__dirname, 'scrub-failure-notes.ts')

/** Secrets shaped as run.ts makes them. */
function suiteSecrets(): SuiteSecrets {
  const body = randomBytes(96).toString('base64')
  return {
    password: `Aa1${randomBytes(12).toString('hex')}`,
    privateKey: `-----BEGIN PRIVATE KEY----- ${body} -----END PRIVATE KEY-----`,
  }
}

/** The key as pem() in e2e/auth-return.spec.ts rebuilds it: 64-character lines. */
function multiLinePem(key: string) {
  const body = key
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/g, '')
  return `-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`
}

const JWT =
  'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJyZWFkZXIiLCJleHAiOjF9.c2lnbmF0dXJlLWJ5dGVz'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

/** A Playwright output folder with one note, the clean folder, the secrets file. */
function setup(note: string, secrets = suiteSecrets()) {
  const root = mkdtempSync(join(tmpdir(), 'auth-e2e-notes-'))
  const output = join(root, 'output')
  const testDir = join(output, 'auth-return-signs-in-iphone-webkit')
  mkdirSync(testDir, { recursive: true })
  writeFileSync(join(testDir, 'error-context.md'), note)
  writeFileSync(join(testDir, 'trace.zip'), secrets.password)
  const secretsFile = join(root, 'secrets.json')
  writeFileSync(secretsFile, JSON.stringify(secrets))
  return {
    root,
    output,
    testDir,
    clean: join(root, 'clean'),
    secretsFile,
    secrets,
  }
}

/** Every file under `dir`, as relative paths. */
function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return []
  return (readdirSync(dir, { recursive: true, encoding: 'utf8' }) as string[])
    .filter((file) => !file.endsWith('/') && readFileSyncSafe(join(dir, file)))
    .sort()
}
function readFileSyncSafe(path: string) {
  try {
    readFileSync(path)
    return true
  } catch {
    return false
  }
}

/** Runs the CI step and returns what CI would upload, with its output. */
function step(output: string, clean: string, secretsFile: string) {
  const run = spawnSync('bun', [SCRIPT, output, clean, secretsFile], {
    encoding: 'utf8',
  })
  const uploaded =
    run.status === 0
      ? filesUnder(clean)
          .filter((file) => file.endsWith('error-context.md'))
          .map((file) => readFileSync(join(clean, file), 'utf8'))
      : []
  return { status: run.status, log: run.stdout + run.stderr, uploaded }
}

function expectNoSecret(text: string, secrets: SuiteSecrets) {
  expect(text).not.toContain(secrets.password)
  expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./)
  expect(text).not.toContain('PRIVATE KEY')
  const body = secrets.privateKey.split(' ')[3]!
  for (const line of body.match(/.{1,64}/g)!) expect(text).not.toContain(line)
}

test('no copy of the password survives, alone or with a character around it', () => {
  const secrets = suiteSecrets()
  const { password } = secrets
  const { output, clean } = setup('', secrets)
  writeFileSync(
    join(output, 'auth-return-signs-in-iphone-webkit', 'error-context.md'),
    [
      '- textbox "Email": reader-1@example.test',
      `- textbox "Password": ${password}`,
      `- textbox "Password": ${password}x`,
      `- textbox "Password": x${password}`,
      `Error: expected "${password}1" to equal ""`,
    ].join('\n')
  )
  expect(copyCleanNotes(output, clean, secrets)).toEqual({
    copied: 1,
    withheld: 0,
  })
  const copy = readFileSync(
    join(clean, 'auth-return-signs-in-iphone-webkit', 'error-context.md'),
    'utf8'
  )
  expectNoSecret(copy, secrets)
  expect(copy).toContain('reader-1@example.test')
})

test('no token or signing key survives, one-line or as the spec rebuilds it', () => {
  const secrets = suiteSecrets()
  const { output, clean } = setup(
    [
      `Error: expect(received).not.toBe(expected)\nExpected: not "${JWT}"`,
      `Received: "${JWT.replace('c2ln', 'ZGlm')}"`,
      secrets.privateKey,
      multiLinePem(secrets.privateKey),
      `key body ${secrets.privateKey.split(' ')[3]}`,
    ].join('\n'),
    secrets
  )
  copyCleanNotes(output, clean, secrets)
  const copy = readFileSync(
    join(clean, 'auth-return-signs-in-iphone-webkit', 'error-context.md'),
    'utf8'
  )
  expectNoSecret(copy, secrets)
})

test('only notes are copied; the raw notes and other files stay where they are', () => {
  const { output, clean, secrets } = setup('- textbox "Email": x@example.test')
  copyCleanNotes(output, clean, secrets)
  expect(filesUnder(clean)).toEqual([
    'auth-return-signs-in-iphone-webkit/error-context.md',
  ])
  expect(filesUnder(output)).toEqual([
    'auth-return-signs-in-iphone-webkit/error-context.md',
    'auth-return-signs-in-iphone-webkit/trace.zip',
  ])
})

test('without the secrets, no note is copied', () => {
  const { output, clean, root, secrets } = setup(
    `- textbox "Password": ${suiteSecrets().password}`
  )
  const run = step(output, clean, join(root, 'missing.json'))
  expect(run.status).toBe(0)
  expect(run.log).toContain('0 copied clean, 1 withheld')
  expect(run.uploaded).toEqual([])
  expectNoSecret(run.log, secrets)
})

test('the CI step prints no secret and removes the secrets file', () => {
  const secrets = suiteSecrets()
  const { output, clean, secretsFile } = setup(
    `- textbox "Password": ${secrets.password}x`,
    secrets
  )
  const run = step(output, clean, secretsFile)
  expect(run.status).toBe(0)
  expect(run.log).toContain('1 copied clean, 0 withheld')
  expectNoSecret(run.log, secrets)
  expect(existsSync(secretsFile)).toBe(false)
  expect(run.uploaded).toHaveLength(1)
  expectNoSecret(run.uploaded[0]!, secrets)
})

test('a symbolic link loop or a linked note is not followed', () => {
  const secrets = suiteSecrets()
  const { output, clean, secretsFile, testDir, root } = setup(
    `- textbox "Password": ${secrets.password}`,
    secrets
  )
  symlinkSync(output, join(testDir, 'loop'))
  const outside = join(root, 'outside')
  mkdirSync(outside)
  writeFileSync(join(outside, 'error-context.md'), secrets.password)
  symlinkSync(
    join(outside, 'error-context.md'),
    join(output, 'error-context.md')
  )
  const run = step(output, clean, secretsFile)
  expect(run.status).toBe(0)
  expect(run.uploaded).toHaveLength(1)
  for (const note of run.uploaded) expectNoSecret(note, secrets)
})

test('a folder named error-context.md is a folder, not a note', () => {
  const secrets = suiteSecrets()
  const { output, clean, secretsFile } = setup(
    `- textbox "Password": ${secrets.password}`,
    secrets
  )
  const odd = join(output, 'error-context.md')
  mkdirSync(odd)
  writeFileSync(join(odd, 'error-context.md'), `${secrets.password}x`)
  const run = step(output, clean, secretsFile)
  expect(run.status).toBe(0)
  expect(run.uploaded).toHaveLength(2)
  for (const note of run.uploaded) expectNoSecret(note, secrets)
})

test('a note it cannot read stops the step, and nothing is uploaded', () => {
  const secrets = suiteSecrets()
  const { output, clean, secretsFile, testDir } = setup(
    `- textbox "Password": ${secrets.password}`,
    secrets
  )
  const note = join(testDir, 'error-context.md')
  chmodSync(note, 0o000)
  cleanups.push(() => chmodSync(note, 0o644))
  const run = step(output, clean, secretsFile)
  expect(run.status).not.toBe(0)
  expect(run.log).toContain('EACCES')
  expect(run.uploaded).toEqual([])
  expectNoSecret(run.log, secrets)
})

test('a note written after the step is not uploaded', () => {
  const secrets = suiteSecrets()
  const { output, clean, secretsFile } = setup('- heading "Sign in"', secrets)
  const run = step(output, clean, secretsFile)
  expect(run.status).toBe(0)
  // The suite outlived the runner and writes one more note.
  const late = join(output, 'auth-return-late-pixel-chromium')
  mkdirSync(late)
  writeFileSync(join(late, 'error-context.md'), secrets.password)
  const uploaded = filesUnder(clean).map((file) =>
    readFileSync(join(clean, file), 'utf8')
  )
  expect(uploaded).toHaveLength(1)
  for (const note of uploaded) expectNoSecret(note, secrets)
})

test('a wrong output path uploads nothing', () => {
  const secrets = suiteSecrets()
  const { output, clean, secretsFile, root } = setup(
    `- textbox "Password": ${secrets.password}`,
    secrets
  )
  const run = step(join(root, 'test-results'), clean, secretsFile)
  expect(run.status).toBe(0)
  expect(run.uploaded).toEqual([])
  // The real notes are not in the clean folder either.
  expect(filesUnder(clean)).toEqual([])
  expect(relative(root, output)).toBe('output')
})

test('a clean folder that is not empty stops the step', () => {
  const { output, clean, secretsFile, secrets } = setup('- heading "Sign in"')
  mkdirSync(clean)
  writeFileSync(join(clean, 'error-context.md'), secrets.password)
  const run = step(output, clean, secretsFile)
  expect(run.status).not.toBe(0)
  expect(run.uploaded).toEqual([])
})

test('a killed step uploads nothing', async () => {
  const secrets = suiteSecrets()
  const { output, clean, secretsFile } = setup(
    `- textbox "Password": ${secrets.password}`,
    secrets
  )
  const child = spawn('bun', [SCRIPT, output, clean, secretsFile])
  child.kill('SIGKILL')
  const status = await new Promise((resolve) =>
    child.once('exit', (code) => resolve(code))
  )
  // CI uploads only after the step succeeded.
  expect(status).not.toBe(0)
  for (const file of filesUnder(clean))
    expectNoSecret(readFileSync(join(clean, file), 'utf8'), secrets)
})
