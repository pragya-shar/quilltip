/**
 * Preload for `scripts/ci/plan.ts`: runs a fixture server up to the point
 * where it would start serving, and records every file its `Bun.build` calls
 * read (the bundler's own list, plugin replacements included). Then it exits
 * without serving.
 *
 *   PLAN_BUNDLE_OUT=<file> bun --preload ./scripts/ci/record-bundle.ts <server.mjs>
 */
import { writeFileSync } from 'node:fs'
import path from 'node:path'

const out = process.env.PLAN_BUNDLE_OUT
if (!out) throw new Error('PLAN_BUNDLE_OUT is not set')

const build = Bun.build
const inputs = new Set<string>()
let builds = 0

Object.assign(Bun, {
  build: async (config: Parameters<typeof Bun.build>[0]) => {
    const result = await build({ ...config, metafile: true })
    builds += 1
    for (const input of Object.keys(result.metafile?.inputs ?? {})) {
      inputs.add(path.resolve(input))
    }
    return result
  },
  serve: () => {
    writeFileSync(out, JSON.stringify({ builds, inputs: [...inputs].sort() }))
    process.exit(0)
  },
})
