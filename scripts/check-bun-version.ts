/**
 * Refuse to run project checks on a Bun older than the `packageManager` pin.
 * Older Bun releases cannot read the current bun.lock format, which shows up
 * later as confusing install or resolution errors.
 */
import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

export function compareVersions(a: string, b: string): number {
  const pa = a.split('-')[0]!.split('.').map(Number)
  const pb = b.split('-')[0]!.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return Math.sign(diff)
  }
  return 0
}

export function requiredBunVersion(packageManager: string | undefined): string {
  const match = packageManager?.match(/^bun@(\d+\.\d+\.\d+)$/)
  if (!match?.[1]) {
    throw new Error('package.json packageManager must be "bun@<x.y.z>"')
  }
  return match[1]
}

export function checkBunVersion(
  current: string,
  packageManager: string | undefined
): string | null {
  const required = requiredBunVersion(packageManager)
  if (compareVersions(current, required) >= 0) return null
  return `Bun ${current} is older than the pinned Bun ${required}. Upgrade Bun (bun upgrade) or run: npx bun@${required} run <script>`
}

const scriptPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
const currentPath = fileURLToPath(import.meta.url)

if (scriptPath === currentPath) {
  const pkg = JSON.parse(
    readFileSync(
      path.join(path.dirname(currentPath), '../package.json'),
      'utf8'
    )
  ) as { packageManager?: string }
  const current = process.versions.bun
  const problem = current
    ? checkBunVersion(current, pkg.packageManager)
    : 'Run project checks with Bun (bun run check).'
  if (problem) {
    console.error(problem)
    process.exitCode = 1
  }
}
