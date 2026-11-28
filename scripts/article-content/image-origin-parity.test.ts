import { readFileSync } from 'node:fs'
import { join } from 'node:path'
// Next's own matcher for `images.remotePatterns`.
import { hasRemoteMatch } from 'next/dist/shared/lib/match-remote-pattern'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertPublishableImages } from '../../convex/lib/articleImages'
import { buildContentSecurityPolicy } from '../../lib/security/contentSecurityPolicy'
import { isArticleImageShown } from '../../lib/tiptap/articleImage'

/**
 * The deployment's own origin is read in four places (#615): the image
 * optimizer (next.config.ts, NEXT_PUBLIC_CONVEX_URL at build), the page
 * policy (proxy.ts, NEXT_PUBLIC_CONVEX_URL per request), the renderers
 * (NEXT_PUBLIC_CONVEX_URL) and the publish check (CONVEX_CLOUD_URL in
 * Convex). Uploaded images come from `ctx.storage.getUrl`,
 * `<CONVEX_CLOUD_URL origin>/api/storage/<id>`. Every place must admit that
 * address for the same deployment, or every uploaded image goes blank.
 */

const root = join(__dirname, '../..')

/** What `ctx.storage.getUrl` returns on a deployment with this URL. */
const storageAddress = (convexUrl: string) =>
  `${new URL(convexUrl).origin}/api/storage/0f6c2b3e-1d7a-4c51-9a8e-6b2f1e0d9c4a`

function policyAdmits(convexUrl: string, address: string): boolean {
  const policy = buildContentSecurityPolicy('n', {
    NEXT_PUBLIC_CONVEX_URL: convexUrl,
  })
  const imgSrc = policy.match(/(?:^|; )img-src ([^;]+)/)?.[1]?.split(' ') ?? []
  // Every entry here is scheme://host[:port]/path-prefix.
  return imgSrc.some(
    (source) => /^https?:\/\//.test(source) && address.startsWith(source)
  )
}

async function optimizerAdmits(convexUrl: string, address: string) {
  vi.stubEnv('NEXT_PUBLIC_CONVEX_URL', convexUrl)
  vi.resetModules()
  const config = (await import('../../next.config')).default
  return hasRemoteMatch(
    [],
    config.images?.remotePatterns ?? [],
    new URL(address)
  )
}

function rendererAdmits(convexUrl: string, address: string) {
  vi.stubEnv('NEXT_PUBLIC_CONVEX_URL', convexUrl)
  return isArticleImageShown(address)
}

function publishAdmits(convexCloudUrl: string, address: string) {
  vi.stubEnv('CONVEX_CLOUD_URL', convexCloudUrl)
  try {
    assertPublishableImages({
      content: { type: 'doc', content: [] },
      coverImage: address,
    })
    return true
  } catch {
    return false
  }
}

afterEach(() => vi.unstubAllEnvs())

describe('one deployment origin for images in every place (#615)', () => {
  it.each([
    ['a hosted deployment', 'https://efficient-tern-39.convex.cloud'],
    [
      'a hosted deployment, trailing slash',
      'https://efficient-tern-39.convex.cloud/',
    ],
    ['the local backend', 'http://127.0.0.1:3210'],
    ['a self-hosted test backend', 'http://127.0.0.1:3330/'],
  ])(
    '%s: the storage address is admitted by the optimizer, the policy, the renderers and publish',
    async (_, convexUrl) => {
      const address = storageAddress(convexUrl)
      expect({
        optimizer: await optimizerAdmits(convexUrl, address),
        policy: policyAdmits(convexUrl, address),
        renderers: rendererAdmits(convexUrl, address),
        publish: publishAdmits(convexUrl, address),
      }).toEqual({
        optimizer: true,
        policy: true,
        renderers: true,
        publish: true,
      })
    }
  )

  it('fails when the app and Convex name different deployments', async () => {
    // Convex emits addresses on its own origin; an app configured with another
    // origin (a custom domain, another deployment) would refuse all of them.
    const address = storageAddress('https://efficient-tern-39.convex.cloud')
    const app = 'https://other-deployment-1.convex.cloud'
    expect({
      optimizer: await optimizerAdmits(app, address),
      policy: policyAdmits(app, address),
      renderers: rendererAdmits(app, address),
      publish: publishAdmits('https://efficient-tern-39.convex.cloud', address),
    }).toEqual({
      optimizer: false,
      policy: false,
      renderers: false,
      publish: true,
    })
  })

  it('each place reads the variable named above', () => {
    const read = (path: string) => readFileSync(join(root, path), 'utf8')
    expect(read('next.config.ts')).toContain(
      'imageRemotePatterns(process.env.NEXT_PUBLIC_CONVEX_URL)'
    )
    expect(read('proxy.ts')).toContain(
      'NEXT_PUBLIC_CONVEX_URL: process.env.NEXT_PUBLIC_CONVEX_URL'
    )
    expect(read('lib/security/contentSecurityPolicy.ts')).toContain(
      'imagePolicySources(env.NEXT_PUBLIC_CONVEX_URL)'
    )
    expect(read('lib/tiptap/articleImage.ts')).toContain(
      'isAllowedImageSource(src, process.env.NEXT_PUBLIC_CONVEX_URL)'
    )
    expect(read('convex/lib/articleImages.ts')).toContain(
      'const convexUrl = process.env.CONVEX_CLOUD_URL'
    )
    expect(read('convex/users.ts')).toContain(
      'isOwnStorageAddress(args.avatar.trim(), process.env.CONVEX_CLOUD_URL)'
    )
  })
})
