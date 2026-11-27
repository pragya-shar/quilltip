// Checks the server HTML of a production build against patches/next@16.4.6.ts:
// on `/`, `/login`, `/articles` and the article page, one blocking loader in
// <head> and no chunk script before the first paint; on `/support`, Next.js's
// own scripts. With PERF_EXPECT_IMMUTABLE=1 it also checks that the build
// used Vercel's immutable chunk path, so a patch that matches only
// /_next/static/chunks/ fails here.
//
//   QUILLTIP_IMMUTABLE_ASSETS=1 NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3299 bun run build
//   PERF_EXPECT_IMMUTABLE=1 bun run perf:chunk-paths
//
// It reads HTML only (no browser), with the fixture backend of perf:budget.

import {
  chunkLoading,
  defaultLoadingProblems,
  deferredLoadingProblems,
} from '../perf/chunk-loading'
import { FIXTURE_ARTICLE_PATH } from '../perf/convex-fixture'
import { startFixtureBackend } from '../perf/fixture-backend'
import { startProductionApp } from '../perf/production-app'

const CONVEX_PORT = Number(process.env.PERF_CONVEX_PORT ?? 3299)
const APP_PORT = Number(process.env.PERF_APP_PORT ?? 3199)
const BASE_URL = `http://127.0.0.1:${APP_PORT}`
const EXPECT_IMMUTABLE = process.env.PERF_EXPECT_IMMUTABLE === '1'
const IMMUTABLE = '/_next/static/immutable/chunks/'

const PATCHED = ['/', '/login', '/articles', FIXTURE_ARTICLE_PATH]
const UNPATCHED = '/support'

async function main() {
  const backend = startFixtureBackend(CONVEX_PORT)
  const app = await startProductionApp(APP_PORT, BASE_URL)
  const failures: string[] = []
  try {
    for (const route of [...PATCHED, UNPATCHED]) {
      const html = await (await fetch(BASE_URL + route)).text()
      const loading = chunkLoading(html, BASE_URL)
      const patched = route !== UNPATCHED
      const problems = patched
        ? deferredLoadingProblems(loading)
        : defaultLoadingProblems(loading)
      for (const problem of problems) failures.push(`${route}: ${problem}`)
      const chunks = patched
        ? [...loading.loaders.flat(), ...loading.inert]
        : loading.eager
      if (EXPECT_IMMUTABLE && !chunks.some((c) => c.startsWith(IMMUTABLE)))
        failures.push(
          `${route}: no chunk under ${IMMUTABLE}; was the build made with QUILLTIP_IMMUTABLE_ASSETS=1?`
        )
      console.log(
        `${route.padEnd(44)} loaders ${loading.loaders.length}  late copies ${loading.lateLoaders.length}  inert ${loading.inert.length}  early ${loading.eager.length}`
      )
    }
  } finally {
    app?.kill()
    backend.closeAllConnections()
    backend.close()
  }
  if (failures.length > 0) {
    console.error(`\nChunk path check failed:\n- ${failures.join('\n- ')}`)
    process.exit(1)
  }
  console.log(
    `\nChunk path check passed${EXPECT_IMMUTABLE ? ' (immutable chunk path)' : ''}.`
  )
  process.exit(0)
}

await main()
