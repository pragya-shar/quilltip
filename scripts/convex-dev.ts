/**
 * Guarded `convex dev`. Package scripts run this instead of calling the
 * Convex CLI directly:
 *
 *   bun scripts/convex-dev.ts [--once | --until-success] [other allowed flags]
 *
 * It runs the deploy-kind network guard on the same environment the CLI
 * inherits, then refuses any flag that could select a different deployment
 * (`--prod`, `--url`, `--admin-key`, `--deployment`, `--env-file`, ...).
 * Only the flags in ALLOWED_FLAGS are passed through.
 */
import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

import {
  NetworkGuardError,
  assertScriptConvexDeployAllowed,
} from './lib/network-guard'

/** Allowed flags; `true` means the flag takes a value. */
const ALLOWED_FLAGS: ReadonlyMap<string, boolean> = new Map([
  ['--once', false],
  ['--until-success', false],
  ['-v', false],
  ['--verbose', false],
  ['--typecheck', true],
  ['--typecheck-components', false],
  ['--codegen', true],
  ['--tail-logs', true],
  ['--run', true],
  ['--run-component', true],
])

/** Return every argument that is not an allowed `convex dev` flag. */
export function refusedConvexDevArgs(args: string[]): string[] {
  const refused: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string
    const eq = arg.indexOf('=')
    const flag = eq === -1 ? arg : arg.slice(0, eq)
    const inlineValue = eq === -1 ? undefined : arg.slice(eq + 1)
    const takesValue = ALLOWED_FLAGS.get(flag)
    if (takesValue === undefined) {
      refused.push(arg)
      continue
    }
    if (takesValue && inlineValue === undefined) {
      const next = args[i + 1]
      if (next === undefined || next.startsWith('-')) {
        refused.push(arg)
        continue
      }
      i++
    } else if (!takesValue && inlineValue !== undefined) {
      refused.push(arg)
    }
  }
  return refused
}

export function checkConvexDev(
  args: string[],
  env: Record<string, string | undefined> = process.env
): void {
  assertScriptConvexDeployAllowed('convex dev', env)
  const refused = refusedConvexDevArgs(args)
  if (refused.length > 0) {
    // Print flag names only: a refused value may be a key or a URL.
    const names = [
      ...new Set(
        refused.map((arg) =>
          arg.startsWith('-') ? (arg.split('=')[0] as string) : '<argument>'
        )
      ),
    ]
    throw new NetworkGuardError('convex dev', [
      {
        code: 'CONVEX_NOT_ALLOWLISTED',
        message: `These arguments are not allowed because they can select another deployment or configuration: ${names.join(' ')}. Set the target with CONVEX_DEPLOYMENT instead.`,
      },
    ])
  }
}

function main(args: string[]): void {
  try {
    checkConvexDev(args)
  } catch (error) {
    if (error instanceof NetworkGuardError) {
      console.error(error.message)
      process.exitCode = 1
      return
    }
    throw error
  }
  const root = fileURLToPath(new URL('../', import.meta.url))
  const cli = path.join(root, 'node_modules', '.bin', 'convex')
  const child = spawn(cli, ['dev', ...args], {
    stdio: 'inherit',
    env: process.env,
  })
  child.on('exit', (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0)
  })
}

const scriptPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (scriptPath === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2))
}
