// First-load JavaScript budget for `/`, `/login`, `/articles` and the article
// page. Needs a production build and the analyzer's output:
//
//   bun run build
//   bun run perf:first-load      # runs `next experimental-analyze --output`
//
// Fails when a route's first-load JavaScript (gzip) is over its budget, or when
// wallet, SDK, contract-binding, IndexedDB or editor code is part of a route's
// first load. See docs/performance/page-load.md, "First-load JavaScript".
import { existsSync, readFileSync } from 'fs'
import path from 'path'
import {
  FIRST_LOAD_BUDGET_KB,
  FIRST_LOAD_ROUTES,
  analyzeDataPath,
  firstLoadModules,
  forbiddenModules,
  largestModules,
  forbiddenText,
  gzipBytes,
  type RouteBundleStats,
} from './first-load'

const STATS = '.next/diagnostics/route-bundle-stats.json'

function main(): number {
  if (!existsSync(STATS)) {
    console.error(`${STATS} is missing. Run \`bun run build\` first.`)
    return 1
  }
  const stats = JSON.parse(readFileSync(STATS, 'utf8')) as RouteBundleStats
  const failures: string[] = []
  for (const route of FIRST_LOAD_ROUTES) {
    const entry = stats.find((item) => item.route === route)
    if (!entry) {
      failures.push(`${route}: not in ${STATS}`)
      continue
    }
    const chunks = entry.firstLoadChunkPaths.map((file) => ({
      file,
      contents: readFileSync(path.resolve(file)),
    }))
    const kb =
      chunks.reduce((sum, chunk) => sum + gzipBytes(chunk.contents), 0) / 1024
    const budget = FIRST_LOAD_BUDGET_KB[route]

    const dataFile = analyzeDataPath(route)
    if (!existsSync(dataFile)) {
      failures.push(
        `${route}: ${dataFile} is missing. Run \`next experimental-analyze --output\` after the build.`
      )
      continue
    }
    const { modules, sizes, jsFiles } = firstLoadModules(readFileSync(dataFile))
    if (kb > budget)
      failures.push(
        `${route}: first-load JavaScript ${kb.toFixed(1)} KB gzip > ${budget} KB budget. Largest modules (analyzer sizes):\n    ${largestModules(sizes).join('\n    ')}`
      )
    // The analyzer compiles the app again; its first load must have the same
    // number of files as the build's, or the module list is not trustworthy.
    if (jsFiles !== chunks.length)
      failures.push(
        `${route}: the analyzer found ${jsFiles} first-load files, the build ${chunks.length}. Re-run the analyzer on this build.`
      )
    const found = [
      ...forbiddenModules(modules),
      ...forbiddenText(
        chunks.map((chunk) => ({
          file: chunk.file,
          contents: chunk.contents.toString('utf8'),
        }))
      ),
    ]
    if (found.length > 0)
      failures.push(
        `${route}: code that must load on demand is in the first load:\n    ${found.join('\n    ')}`
      )
    console.log(
      `${route.padEnd(20)} ${kb.toFixed(1).padStart(6)} KB gzip (budget ${budget})  ${chunks.length} files  ${modules.size} modules  forbidden: ${found.length}`
    )
  }
  if (failures.length > 0) {
    console.error(`\nFirst-load budget failed:\n- ${failures.join('\n- ')}`)
    return 1
  }
  console.log('\nFirst-load budget passed.')
  return 0
}

process.exit(main())
