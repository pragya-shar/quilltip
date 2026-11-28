import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * The surface packages, read from the segment registry: one file per package
 * in lib/routing/segments, less the shell's own (foundation) and the legacy
 * pages. A package that adds its segments file is covered by the shell's lint
 * rules for components/<package>/ with no edit here.
 */
export const SURFACE_PACKAGES = readdirSync(
  path.join(root, 'lib/routing/segments')
)
  .filter((name) => name.endsWith('.ts') && name !== 'index.ts')
  .map((name) => name.slice(0, -3))
  .filter((name) => name !== 'foundation' && name !== 'legacy')
  .sort()
