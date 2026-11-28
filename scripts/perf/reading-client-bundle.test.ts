import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'

/**
 * The reading pages' client components (#609): the readable fallback, the
 * outage modules and the paused-deployment rule are server only. Walks each
 * client component's imports as a bundler does, with packages left out, and
 * fails if any of them enters a client bundle.
 */
const CLIENT_ENTRIES = [
  'components/articles/ArticlePageClient.tsx',
  'components/articles/ReadingRoomPage.tsx',
  'components/profile/ProfilePageClient.tsx',
]
const SERVER_ONLY = [
  'components/articles/ReadingUnavailable.tsx',
  'lib/outage/unavailableCopy.ts',
  'lib/outage/legacyOutageBody.ts',
  'lib/outage/outageBody.ts',
  'lib/convex/pausedDeployment.ts',
  'lib/convex/pausedSentence.ts',
  'hooks/convex/useReadingQuery.ts',
  'lib/seo/publicQuery.ts',
]

async function clientInputs(entry: string): Promise<string[]> {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    metafile: true,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    alias: { '@': '.' },
    packages: 'external',
    loader: { '.css': 'empty', '.woff2': 'empty', '.svg': 'empty' },
    logLevel: 'silent',
  })
  return Object.keys(result.metafile.inputs)
}

describe('reading pages keep the fallback out of the client bundle', () => {
  it.each(CLIENT_ENTRIES)(
    '%s',
    async (entry) => {
      const inputs = await clientInputs(entry)
      // The walk saw the page's own modules, so an absence below means
      // something.
      expect(inputs).toContain('hooks/convex/useArticles.ts')
      for (const file of SERVER_ONLY) expect(inputs, file).not.toContain(file)
    },
    30_000
  )
})
