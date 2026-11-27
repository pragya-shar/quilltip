// Checks that a server which has not registered the Next.js patch keeps
// Next.js's own script output and hydrates, even though the runtimes in
// node_modules are patched. That is the state of a checkout without the patch
// after a branch switch: patches/next@16.4.6.ts left the runtimes patched, and
// that checkout has no instrumentation.ts registration.
//
//   NEXT_PUBLIC_CONVEX_URL=http://127.0.0.1:3299 bun run build
//   bun run perf:stale-runtime
//
// The server here starts with QUILLTIP_HYDRATE_AFTER_PAINT=false, which makes
// instrumentation.ts skip the registration: the patched runtime then sees the
// same thing as in a checkout without the patch. The fixture backend is the
// one perf:budget uses. See docs/performance/next-patch.md.

import { chromium } from '@playwright/test'
import { readFileSync } from 'fs'
import path from 'path'
import {
  REGISTRATION,
  RUNTIMES,
  installedNext,
} from '../../patches/next@16.4.6'
import { chunkLoading, defaultLoadingProblems } from '../perf/chunk-loading'
import { FIXTURE_ARTICLE_PATH } from '../perf/convex-fixture'
import { startFixtureBackend } from '../perf/fixture-backend'
import { startProductionApp } from '../perf/production-app'

const CONVEX_PORT = Number(process.env.PERF_CONVEX_PORT ?? 3299)
const APP_PORT = Number(process.env.PERF_APP_PORT ?? 3199)
const BASE_URL = `http://127.0.0.1:${APP_PORT}`
const ROUTES = ['/', '/login', '/articles', FIXTURE_ARTICLE_PATH]

async function main() {
  const failures: string[] = []
  // Without patched runtimes this check would prove nothing.
  const { root } = installedNext()
  for (const runtime of RUNTIMES)
    if (!readFileSync(path.join(root, runtime), 'utf8').includes(REGISTRATION))
      failures.push(
        `${runtime} is not patched; run \`bun run build\` first, which applies patches/next@16.4.6.ts`
      )
  if (failures.length > 0) {
    console.error(`Stale runtime check failed:\n- ${failures.join('\n- ')}`)
    process.exit(1)
  }

  process.env.QUILLTIP_HYDRATE_AFTER_PAINT = 'false'
  const backend = startFixtureBackend(CONVEX_PORT)
  const app = await startProductionApp(APP_PORT, BASE_URL)
  const browser = await chromium.launch()
  try {
    for (const route of ROUTES) {
      const html = await (await fetch(BASE_URL + route)).text()
      for (const problem of defaultLoadingProblems(
        chunkLoading(html, BASE_URL)
      ))
        failures.push(`${route}: ${problem}`)

      const page = await browser.newPage()
      // A checkout without the patch has no public/hydrate-after-paint.js.
      await page.route(/\/hydrate-after-paint\.js/, (request) =>
        request.abort()
      )
      try {
        await page.goto(BASE_URL + route, { waitUntil: 'load' })
        // Hydrated: React has attached its props to a link in the page.
        const hydrated = await page
          .waitForFunction(
            () => {
              const link = document.querySelector(
                'main a[href], header a[href], nav a[href]'
              )
              return (
                !!link &&
                Object.keys(link).some((key) => key.startsWith('__reactProps'))
              )
            },
            undefined,
            { timeout: 20_000 }
          )
          .then(() => true)
          .catch(() => false)
        console.log(
          `${route.padEnd(36)} ${hydrated ? 'hydrated' : 'NOT hydrated'}`
        )
        if (!hydrated) failures.push(`${route}: the page did not hydrate`)
      } finally {
        await page.close()
      }
    }
  } finally {
    await browser.close()
    app?.kill()
    backend.closeAllConnections()
    backend.close()
  }
  if (failures.length > 0) {
    console.error(`\nStale runtime check failed:\n- ${failures.join('\n- ')}`)
    process.exit(1)
  }
  console.log(
    '\nStale runtime check passed: without the registration, the patched runtime keeps Next.js output.'
  )
  process.exit(0)
}

await main()
