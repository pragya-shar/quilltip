import { spawnSync } from 'node:child_process'
import path from 'node:path'

/**
 * Stops the run before any test when the target is not the v3 testnet: runs
 * the target preflight (`scripts/real-run/target-preflight.ts`, an ES
 * module, so in its own Bun process) and fails on a non-zero exit.
 */
export default function globalSetup() {
  const expect = process.env.REAL_RUN_EXPECT
  if (!expect) throw new Error('Set REAL_RUN_EXPECT to the expected env file.')
  if (!process.env.REAL_RUN_ACCOUNTS)
    throw new Error('Set REAL_RUN_ACCOUNTS to the test accounts file.')
  const root = path.resolve(__dirname, '../..')
  const out = spawnSync(
    'npx',
    [
      'bun@1.4.4',
      'scripts/real-run/target-preflight.ts',
      '--base-url',
      process.env.REAL_RUN_BASE_URL ?? 'http://127.0.0.1:3240',
      '--expect',
      expect,
    ],
    { cwd: root, encoding: 'utf8' }
  )
  if (out.status !== 0)
    throw new Error(`Target check failed:\n${out.stdout}\n${out.stderr}`)
}
