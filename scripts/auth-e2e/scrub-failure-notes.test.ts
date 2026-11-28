import { expect, test } from 'vitest'
import { spawnSync } from 'child_process'
import { randomBytes } from 'crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { scrubFailureNotes, type SuiteSecrets } from './scrub-failure-notes'

/**
 * The failure notes CI uploads (scrub-failure-notes.ts) keep none of the
 * sign-in suite's secrets: not the run's password, alone or inside a longer
 * string, not its signing key, and no token.
 */

/** Secrets shaped as run.ts makes them. */
function suiteSecrets(): SuiteSecrets {
  const body = randomBytes(48).toString('base64')
  return {
    password: `Aa1${randomBytes(12).toString('hex')}`,
    privateKey: `-----BEGIN PRIVATE KEY----- ${body} -----END PRIVATE KEY-----`,
  }
}

const JWT =
  'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJyZWFkZXIiLCJleHAiOjF9.c2lnbmF0dXJlLWJ5dGVz'

/** A results folder with one note, as Playwright writes it. */
function results(note: string) {
  const dir = mkdtempSync(join(tmpdir(), 'auth-e2e-notes-'))
  const testDir = join(dir, 'auth-return-signs-in-iphone-webkit')
  mkdirSync(testDir)
  writeFileSync(join(testDir, 'error-context.md'), note)
  writeFileSync(join(testDir, 'trace.zip'), 'not uploaded')
  return { dir, note: join(testDir, 'error-context.md') }
}

test('no copy of the password survives, alone or with a character around it', () => {
  const secrets = suiteSecrets()
  const { password } = secrets
  const { dir, note } = results(
    [
      '- textbox "Email": reader-1@example.test',
      `- textbox "Password": ${password}`,
      `- textbox "Password": ${password}x`,
      `- textbox "Password": x${password}`,
      `Error: expected "${password}1" to equal ""`,
    ].join('\n')
  )
  expect(scrubFailureNotes(dir, secrets)).toEqual({ scrubbed: 1, deleted: 0 })
  const text = readFileSync(note, 'utf8')
  expect(text).not.toContain(password)
  expect(text).toContain('reader-1@example.test')
})

test('no token or signing key survives', () => {
  const secrets = suiteSecrets()
  const keyBody = secrets.privateKey.split(' ')[3]!
  const { dir, note } = results(
    [
      `Error: expect(received).not.toBe(expected)\nExpected: not "${JWT}"`,
      `Received: "${JWT.replace('c2ln', 'ZGlm')}"`,
      secrets.privateKey,
      `key body ${keyBody}`,
    ].join('\n')
  )
  scrubFailureNotes(dir, secrets)
  const text = readFileSync(note, 'utf8')
  expect(text).not.toMatch(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./)
  expect(text).not.toContain('PRIVATE KEY')
  expect(text).not.toContain(keyBody)
})

test('without the secrets, a note cannot be proved clean and is deleted', () => {
  const secrets = suiteSecrets()
  const { dir, note } = results(`- textbox "Password": ${secrets.password}`)
  expect(scrubFailureNotes(dir, null)).toEqual({ scrubbed: 0, deleted: 1 })
  expect(existsSync(note)).toBe(false)
  // Only the notes are uploaded; other files stay.
  expect(
    existsSync(join(dir, 'auth-return-signs-in-iphone-webkit', 'trace.zip'))
  ).toBe(true)
})

test('the CI step prints no secret and removes the secrets file', () => {
  const secrets = suiteSecrets()
  const { dir, note } = results(`- textbox "Password": ${secrets.password}x`)
  const secretsFile = join(dir, 'secrets.json')
  writeFileSync(secretsFile, JSON.stringify(secrets))
  const step = spawnSync(
    'bun',
    [join(__dirname, 'scrub-failure-notes.ts'), dir, secretsFile],
    { encoding: 'utf8' }
  )
  expect(step.status).toBe(0)
  expect(step.stdout).toContain('1 scrubbed, 0 deleted')
  expect(step.stdout + step.stderr).not.toContain(secrets.password)
  expect(existsSync(secretsFile)).toBe(false)
  expect(readFileSync(note, 'utf8')).not.toContain(secrets.password)
})

test('the CI step deletes the notes when the run left no secrets file', () => {
  const secrets = suiteSecrets()
  const { dir, note } = results(`- textbox "Password": ${secrets.password}`)
  const step = spawnSync(
    'bun',
    [join(__dirname, 'scrub-failure-notes.ts'), dir, join(dir, 'missing.json')],
    { encoding: 'utf8' }
  )
  expect(step.status).toBe(0)
  expect(step.stdout).toContain('0 scrubbed, 1 deleted')
  expect(existsSync(note)).toBe(false)
})
