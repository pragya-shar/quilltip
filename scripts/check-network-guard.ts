/**
 * Command-line testnet guard. Package scripts that push Convex functions or
 * run operational tools call this first:
 *
 *   bun scripts/check-network-guard.ts            # Stellar + Convex checks
 *   bun scripts/check-network-guard.ts --convex   # Convex-only checks
 *
 * Bun loads .env and .env.local automatically. Exits 1 on any refusal.
 */
import path from 'path'
import { fileURLToPath } from 'url'

import {
  NetworkGuardError,
  assertScriptNonProductionConvex,
  assertScriptTestnetOnly,
} from './lib/network-guard'

export function runNetworkGuardCli(
  args: string[],
  env: Record<string, string | undefined> = process.env
): number {
  const convexOnly = args.includes('--convex')
  const labelIndex = args.indexOf('--operation')
  const operation =
    labelIndex >= 0 && args[labelIndex + 1]
      ? (args[labelIndex + 1] as string)
      : convexOnly
        ? 'convex functions push'
        : 'testnet operation'

  try {
    const result = convexOnly
      ? assertScriptNonProductionConvex(operation, env)
      : assertScriptTestnetOnly(operation, env)
    const target = result.convexDeployments.join(', ') || 'none'
    console.log(
      `Network guard passed for "${operation}" (Convex: ${target}${convexOnly ? '' : ', Stellar: TESTNET'}).`
    )
    return 0
  } catch (error) {
    if (error instanceof NetworkGuardError) {
      console.error(error.message)
      return 1
    }
    throw error
  }
}

const scriptPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (scriptPath === fileURLToPath(import.meta.url)) {
  process.exitCode = runNetworkGuardCli(process.argv.slice(2))
}
