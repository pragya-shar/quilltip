import { createHash, generateKeyPairSync } from 'node:crypto'
import { DataItem } from '@dha-team/arbundles/node'
import { build } from 'esbuild'
import { afterEach, expect, it, vi } from 'vitest'
import { uploadArticle, uploadJsonWithTurbo } from '../../../lib/arweave/client'
import { buildArticleUpload } from '../../../lib/arweave/articleUpload'
import { ARWEAVE_CONFIG } from '../../../lib/arweave/config'
import type { JWKInterface } from 'arweave/node/lib/wallet'

afterEach(() => vi.unstubAllGlobals())

it('bundles the Convex Arweave action without the optional payment stack', async () => {
  const result = await build({
    entryPoints: ['convex/arweave.ts'],
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
    metafile: true,
    logLevel: 'silent',
  })
  expect(result.errors).toEqual([])
  expect(Object.keys(result.metafile!.inputs)).not.toEqual(
    expect.arrayContaining([expect.stringContaining('node_modules/x402')])
  )
}, 20_000)

it('uploads RSA-signed canonical article bytes and metadata JSON through the real Turbo SDK without network writes', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 4096 })
  const jwk = privateKey.export({ format: 'jwk' }) as JWKInterface
  const items: DataItem[] = []
  // Intercept the final transport, not the SDK/factory/signer. No request leaves
  // this process, including unexpected payment or gateway requests.
  const transport = vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe('https://upload.ardrive.io/v1/tx/arweave')
    expect(init?.method).toBe('POST')
    expect(init?.signal?.aborted).toBe(false)
    const bytes = await new Response(init?.body).arrayBuffer()
    const item = new DataItem(Buffer.from(bytes))
    expect(item.signatureType).toBe(1)
    expect(await item.isValid()).toBe(true)
    items.push(item)
    return Response.json({ id: item.id })
  })
  vi.stubGlobal('fetch', transport)

  const article = await buildArticleUpload({
    articleId: 'local-article',
    authorId: 'local-author',
    title: 'Dependency compatibility',
    content: { type: 'doc', content: [] },
    contentVersion: 1,
    authorUsername: 'QA',
    uploadedAt: 1,
  })
  const metadata = { name: 'Local metadata', description: 'Never published' }
  const results = [
    await uploadArticle(article, jwk),
    await uploadJsonWithTurbo(metadata, jwk, [
      { name: 'Article-Id', value: 'local-only' },
    ]),
  ]
  expect(transport).toHaveBeenCalledTimes(2)

  // The signed article body is exactly the canonical article bytes.
  const articleItem = items[0]!
  expect(new Uint8Array(articleItem.rawData)).toEqual(article.body)
  const articleHash = createHash('sha256')
    .update(articleItem.rawData)
    .digest('hex')
  expect(articleHash).toBe(article.contentHash)
  expect(articleItem.tags).toEqual(article.tags)
  expect(articleItem.tags).toContainEqual({
    name: 'Content-Hash',
    value: articleHash,
  })
  expect(articleItem.tags).toContainEqual({ name: 'Timestamp', value: '1' })
  expect(results[0]).toEqual({
    success: true,
    txId: articleItem.id,
    url: `https://arweave.net/${articleItem.id}`,
    contentHash: articleHash,
  })

  const metadataItem = items[1]!
  const metadataHash = createHash('sha256')
    .update(JSON.stringify(metadata))
    .digest('hex')
  expect(metadataItem.rawData.toString()).toBe(JSON.stringify(metadata))
  expect(metadataItem.tags).toEqual(
    expect.arrayContaining([
      { name: 'Content-Type', value: 'application/json' },
      { name: 'App-Name', value: 'Quilltip' },
      { name: 'Content-Hash', value: metadataHash },
      { name: 'Data-Type', value: 'quilltip-nft-metadata' },
      { name: 'Article-Id', value: 'local-only' },
    ])
  )
  expect(results[1]).toEqual({
    success: true,
    txId: metadataItem.id,
    url: `https://arweave.net/${metadataItem.id}`,
    contentHash: metadataHash,
  })

  // A body that does not match its hash is refused before any request.
  const tampered = await uploadArticle(
    { ...article, body: new TextEncoder().encode('{}') },
    jwk
  )
  expect(tampered.success).toBe(false)
  expect(transport).toHaveBeenCalledTimes(2)

  const tooLarge = await uploadJsonWithTurbo(
    'x'.repeat(ARWEAVE_CONFIG.HARD_LIMIT_BYTES),
    jwk,
    []
  )
  expect(tooLarge.success).toBe(false)
  expect(transport).toHaveBeenCalledTimes(2)
}, 20_000)
