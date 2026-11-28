import { build } from 'esbuild'
import { describe, expect, it } from 'vitest'

/**
 * The reading pages' client components (#609): the readable fallback and the
 * outage modules are rendered on the server only, and the client carries
 * only the paused sentence, not the server's anchored match. Walks each
 * client component's imports as a bundler does, with packages left out.
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
      expect(inputs).toContain('hooks/convex/useReadingQuery.ts')
      expect(inputs).toContain('lib/convex/pausedSentence.ts')
      for (const file of SERVER_ONLY) expect(inputs, file).not.toContain(file)
    },
    30_000
  )
})
