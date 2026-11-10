import { once } from 'node:events'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { StellarToml } from '@stellar/stellar-sdk'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)

it('uses the portable converter through the real Turbo Solana dependency', () => {
  const fromTurbo = createRequire(require.resolve('@ardrive/turbo-sdk/node'))
  const fromToken = createRequire(fromTurbo.resolve('@solana/spl-token'))
  const layoutEntry = fromToken.resolve('@solana/buffer-layout-utils')
  const fromLayout = createRequire(layoutEntry)
  const converter = fromLayout('bigint-buffer')
  const converterManifest = fromLayout('bigint-buffer/package.json')
  expect(converterManifest.name).toBe('@quilltip/portable-bigint-buffer')
  expect(converterManifest.scripts).toBeUndefined()

  const layout = require(layoutEntry)
  const value = BigInt('0xfedcba9876543210')
  for (const [factory, hex] of [
    [layout.u64, '1032547698badcfe'],
    [layout.u64be, 'fedcba9876543210'],
  ] as const) {
    const field = factory()
    const bytes = Buffer.alloc(8)
    expect(field.encode(value, bytes, 0)).toBe(8)
    expect(bytes.toString('hex')).toBe(hex)
    expect(field.decode(bytes, 0)).toBe(value)
  }

  const large = Buffer.alloc(160, 255)
  expect(converter.toBigIntLE(large)).toBe(BigInt('0x' + 'ff'.repeat(160)))
  expect(converter.toBigIntBE(Buffer.alloc(0))).toBe(BigInt(0))
  expect(() => converter.toBigIntLE(null)).toThrow(TypeError)
})

it('resolves normal Stellar TOML through the patched CommonJS parser', async () => {
  const fromStellar = createRequire(require.resolve('@stellar/stellar-sdk'))
  expect(fromStellar('toml/package.json').version).toBe('5.0.1')

  const server = createServer((request, response) => {
    if (request.url !== '/.well-known/stellar.toml') {
      response.writeHead(404).end()
      return
    }
    response.end(
      'NETWORK_PASSPHRASE = "Test SDF Network ; September 2015"\n' +
        '[[CURRENCIES]]\ncode = "TEST"\n'
    )
  })
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No port')
    await expect(
      StellarToml.Resolver.resolve(`127.0.0.1:${address.port}`, {
        allowHttp: true,
      })
    ).resolves.toMatchObject({
      NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
      CURRENCIES: [{ code: 'TEST' }],
    })
  } finally {
    server.close()
  }
})
