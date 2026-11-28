import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isOwnStorageAvatar, shownAvatar } from '../../lib/profile/shownAvatar'
import {
  isAllowedImageSource,
  isOwnStorageAddress,
} from '../../lib/security/imageSources'

/**
 * One definition of "own storage" (#633): the photo shown
 * (`lib/profile/shownAvatar.ts`, in the browser), the photo saved
 * (`isOwnStorageAddress`, in Convex) and the own-origin entry of the image
 * list (`isAllowedImageSource`) agree on every address below. They are two
 * small functions so `UserAvatar` does not carry the image source list.
 */

const HOSTED = 'https://own-deployment-123.convex.cloud'
const LOCAL = 'http://127.0.0.1:3210'
const SELF_HOSTED = 'https://convex.example.org:8443'

const DEPLOYMENTS = [
  HOSTED,
  `${HOSTED}/`,
  ` ${HOSTED} `,
  LOCAL,
  SELF_HOSTED,
  undefined,
  '',
  'not a url',
  'ftp://own-deployment-123.convex.cloud',
  // Not http or https: no own storage, whatever the address.
  'ws://own-deployment-123.convex.cloud',
]

const onOrigin = (origin: string) => [
  `${origin}/api/storage/5c1e2f0a-photo`,
  `${origin}/api/storage/a?w=200`,
  `${origin}/api/storage/../x`,
  `${origin}/api/storage/%2e%2e/x`,
  `${origin}/api/storage%2F..%2Fx`,
  `${origin}/api%2Fstorage/x`,
  `${origin}/x?/api/storage/y`,
  `${origin}/x#/api/storage/y`,
  `${origin}/api/storagex/a`,
  `${origin}/api/query`,
  `${origin}/`,
]

const ADDRESSES = [
  ...onOrigin(HOSTED),
  ...onOrigin(LOCAL),
  ...onOrigin(SELF_HOSTED),
  `${HOSTED}:443/api/storage/x`,
  // Credentials.
  'https://user@own-deployment-123.convex.cloud/api/storage/x',
  'https://user:pass@own-deployment-123.convex.cloud/api/storage/x',
  // A password without a user name.
  'https://:pw@own-deployment-123.convex.cloud/api/storage/x',
  'http://:pw@127.0.0.1:3210/api/storage/x',
  'http://user@127.0.0.1:3210/api/storage/x',
  // Another deployment, and hosts that only look like this one.
  'https://someone-else-456.convex.cloud/api/storage/x',
  'https://own-deployment-123.convex.cloud.evil.example/api/storage/x',
  'https://x-own-deployment-123.convex.cloud/api/storage/x',
  'https://own-deployment-123.convex.site/api/storage/x',
  // Another scheme or port.
  'http://own-deployment-123.convex.cloud/api/storage/x',
  'https://own-deployment-123.convex.cloud:8443/api/storage/x',
  'https://127.0.0.1:3210/api/storage/x',
  'http://127.0.0.1:3211/api/storage/x',
  'http://localhost:3210/api/storage/x',
  'https://convex.example.org/api/storage/x',
  'https://convex.example.org:8444/api/storage/x',
  'blob:https://own-deployment-123.convex.cloud/api/storage/x',
  'ws://own-deployment-123.convex.cloud/api/storage/x',
  'data:image/png;base64,iVBORw0KGgo=',
  'javascript:alert(1)',
  '/api/storage/relative',
  'not an address',
  '',
  // The listed stock hosts: images, never photos.
  'https://images.unsplash.com/photo-1?w=200',
  'https://plus.unsplash.com/premium_photo-1',
  'https://arweave.net/bNbA3TEQVL60xlgCcqdz4ZPHFZ711cZ3hmkpGttDt_U',
  'https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg',
]

afterEach(() => vi.unstubAllEnvs())

describe('own storage, shown and saved (#633)', () => {
  it.each(DEPLOYMENTS)(
    'the photo shown and the photo saved agree for the deployment %j',
    (deployment) => {
      for (const src of ADDRESSES) {
        expect(isOwnStorageAvatar(src, deployment), src).toBe(
          isOwnStorageAddress(src, deployment)
        )
      }
    }
  )

  it.each(DEPLOYMENTS)(
    'the own-origin entry of the image list agrees for the deployment %j',
    (deployment) => {
      for (const src of ADDRESSES) {
        // Addresses on a listed host are allowed images, not own storage.
        if (isAllowedImageSource(src, undefined)) continue
        expect(isAllowedImageSource(src, deployment), src).toBe(
          isOwnStorageAddress(src, deployment)
        )
      }
    }
  )

  it.each([HOSTED, LOCAL, SELF_HOSTED])(
    'UserAvatar shows exactly the own-storage photos of %s',
    (deployment) => {
      vi.stubEnv('NEXT_PUBLIC_CONVEX_URL', deployment)
      const shown = ADDRESSES.filter((src) => shownAvatar(src) !== undefined)
      expect(shown).toEqual(
        ADDRESSES.filter((src) => isOwnStorageAddress(src, deployment))
      )
      // Not vacuous: each deployment shows its own uploads and nothing else.
      expect(shown).toContain(`${deployment}/api/storage/5c1e2f0a-photo`)
      expect(shown.every((src) => src.includes('/api/storage/'))).toBe(true)
      expect(
        shown.some((src) => src.includes('unsplash') || src.includes('arweave'))
      ).toBe(false)
    }
  )

  it('the hosted deployment shows its uploads, the default port included, and nothing else', () => {
    expect(ADDRESSES.filter((src) => isOwnStorageAvatar(src, HOSTED))).toEqual([
      `${HOSTED}/api/storage/5c1e2f0a-photo`,
      `${HOSTED}/api/storage/a?w=200`,
      `${HOSTED}:443/api/storage/x`,
    ])
  })

  it('UserAvatar imports the one predicate, not the image source list', () => {
    const read = (path: string) =>
      readFileSync(join(__dirname, '../..', path), 'utf8')
    const avatar = read('components/ui/user-avatar.tsx')
    expect(avatar).toContain("from '@/lib/profile/shownAvatar'")
    for (const source of [avatar, read('lib/profile/shownAvatar.ts')]) {
      expect(source).not.toMatch(/from '[^']*(imageSources|articleImage)'/)
    }
  })
})
