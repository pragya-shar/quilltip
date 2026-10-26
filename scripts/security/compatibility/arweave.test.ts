import { createHash, generateKeyPairSync } from 'node:crypto'
import { DataItem } from '@dha-team/arbundles/node'
import { build } from 'esbuild'
import { afterEach, expect, it, vi } from 'vitest'
import { uploadArticle, uploadJsonWithTurbo } from '../../../lib/arweave/client'
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

it('uploads RSA-signed article and metadata JSON through the real Turbo SDK without network writes', async () => {
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

  const article = {
    title: 'Dependency compatibility',
    body: { type: 'doc', content: [] },
    author: 'QA',
    authorId: 'local-only',
    timestamp: 1,
    version: 1,
  }
  const metadata = { name: 'Local metadata', description: 'Never published' }
  const results = [
    await uploadArticle(article, jwk),
    await uploadJsonWithTurbo(metadata, jwk, [
      { name: 'Article-Id', value: 'local-only' },
    ]),
  ]
  expect(transport).toHaveBeenCalledTimes(2)
  for (const [index, payload] of [article, metadata].entries()) {
    const item = items[index]!
    const hash = createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex')
    expect(item.rawData.toString()).toBe(JSON.stringify(payload))
    expect(item.tags).toEqual(
      expect.arrayContaining([
        { name: 'Content-Type', value: 'application/json' },
        { name: 'App-Name', value: 'Quilltip' },
        { name: 'Content-Hash', value: hash },
      ])
    )
    expect(results[index]).toEqual({
      success: true,
      txId: item.id,
      url: `https://arweave.net/${item.id}`,
      contentHash: hash,
    })
  }
  expect(items[0]!.tags).toContainEqual({
    name: 'Article-Title',
    value: article.title,
  })
  expect(items[1]!.tags).toContainEqual({
    name: 'Data-Type',
    value: 'quilltip-nft-metadata',
  })
  expect(items[1]!.tags).toContainEqual({
    name: 'Article-Id',
    value: 'local-only',
  })

  const tooLarge = await uploadJsonWithTurbo(
    'x'.repeat(ARWEAVE_CONFIG.HARD_LIMIT_BYTES),
    jwk,
    []
  )
  expect(tooLarge.success).toBe(false)
  expect(transport).toHaveBeenCalledTimes(2)
}, 20_000)
