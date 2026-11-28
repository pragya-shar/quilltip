import { readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Plain unit tests for lib/ helpers and tooling that need no Convex runtime.
//
// One rule, so no package edits this file: every `scripts/<dir>/*.test.ts`
// runs here, unless `scripts/<dir>` has a Vitest config of its own
// (`*.config.mts`): those suites need the Convex or edge runtime, a local
// network or a security setup, and run through their own script in
// package.json. A package's tests go in `scripts/<package>/`.

const scripts = path.dirname(fileURLToPath(import.meta.url))

/** Directories under scripts/ with tests and no config of their own. */
export function unitTestDirs(root = scripts): string[] {
  return readdirSync(root)
    .filter((name) => statSync(path.join(root, name)).isDirectory())
    .filter((name) => {
      const files = readdirSync(path.join(root, name))
      return (
        files.some((file) => file.endsWith('.test.ts')) &&
        !files.some((file) => file.endsWith('.config.mts'))
      )
    })
    .sort()
}

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: [
      ...unitTestDirs().map((dir) => `scripts/${dir}/*.test.ts`),
      // The one scripts/chain suite that needs no edge runtime; the others
      // run in it (test:chain).
      'scripts/chain/canonical-article.test.ts',
    ],
  },
})
