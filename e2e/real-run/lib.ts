/**
 * Shared pieces of the real-run suite: a local, guarded run against the v3
 * testnet backend that CI never starts. Every entry point runs the target
 * preflight first and stops on any mismatch.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  chromium,
  devices,
  type BrowserContext,
  type Page,
} from '@playwright/test'
import {
  expectedFrom,
  parseEnvFile,
  runTargetPreflight,
} from '../../scripts/real-run/target-preflight'
import { installTestnetWallet } from '../helpers/testnetWallet'

export const BASE_URL = process.env.REAL_RUN_BASE_URL ?? 'http://127.0.0.1:3240'

export function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

export type Account = {
  email: string
  password: string
  name: string
  publicKey: string
  secret: string
}

export function readAccounts(file: string): {
  reader: Account
  writer: Account
} {
  const env = parseEnvFile(file)
  const pick = (role: 'READER' | 'WRITER'): Account => ({
    email: env[`SLICE_${role}_EMAIL`]!,
    password: env[`SLICE_${role}_PASSWORD`]!,
    name: env[`SLICE_${role}_NAME`]!,
    publicKey: env[`SLICE_${role}_PUBLIC`]!,
    secret: env[`SLICE_${role}_SECRET`]!,
  })
  return { reader: pick('READER'), writer: pick('WRITER') }
}

/** Fails closed: no step that writes runs against the wrong target. */
export async function preflight(expectFile: string) {
  const report = await runTargetPreflight({
    baseUrl: BASE_URL,
    expected: expectedFrom(parseEnvFile(expectFile)),
  })
  if (!report.pass) {
    console.error(JSON.stringify(report, null, 2))
    throw new Error(`Target check failed: ${report.failures.join('; ')}`)
  }
  return report
}

export const PHONE = {
  ...devices['iPhone 13'],
  viewport: { width: 390, height: 844 },
}

/** A phone with its own storage that survives close and reopen. */
export async function phone(
  profileDir: string,
  account: Account,
  options: { videoDir?: string } = {}
): Promise<{ context: BrowserContext; page: Page }> {
  const { defaultBrowserType: _ignored, ...device } = PHONE
  const context = await chromium.launchPersistentContext(profileDir, {
    ...device,
    baseURL: BASE_URL,
    ...(options.videoDir
      ? {
          recordVideo: {
            dir: options.videoDir,
            size: { width: 390, height: 844 },
          },
        }
      : {}),
  })
  await installTestnetWallet(context, account.secret)
  const page = context.pages()[0] ?? (await context.newPage())
  return { context, page }
}

export async function shot(page: Page, dir: string, name: string) {
  await page.screenshot({ path: path.join(dir, `${name}.png`) })
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}
