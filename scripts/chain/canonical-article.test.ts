import { createHash } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import vectorsFile from '../../contracts/shared/test-vectors.json'
import {
  CanonicalJsonError,
  canonicalJson,
} from '../../convex/lib/chain/canonicalJson'
import {
  ARTICLE_SCHEMA,
  CanonicalArticleError,
  articleContentHash,
  articleContentHashHex,
  bytesToHex,
  canonicalArticle,
  canonicalArticleBytes,
  type CanonicalArticleInput,
} from '../../convex/lib/chain/ids'
import { buildArticleUpload } from '../../lib/arweave/articleUpload'

const vectors = vectorsFile.canonicalArticleBytes.vectors
const nodeSha256 = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex')
const utf8 = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

/** Deterministic PRNG (mulberry32), so property runs are reproducible. */
function prng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Reverses or shuffles key insertion order at every level. */
function reorderKeys(value: unknown, random: () => number): unknown {
  if (Array.isArray(value))
    return value.map((item) => reorderKeys(item, random))
  if (value && typeof value === 'object') {
    const keys = Object.keys(value)
    for (let i = keys.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      ;[keys[i], keys[j]] = [keys[j]!, keys[i]!]
    }
    const out: Record<string, unknown> = {}
    for (const key of keys) {
      out[key] = reorderKeys((value as Record<string, unknown>)[key], random)
    }
    return out
  }
  return value
}

const CODE_POINTS = [
  0x00, 0x09, 0x0a, 0x0d, 0x1f, 0x22, 0x2f, 0x41, 0x5c, 0x7f, 0x80, 0xe9, 0x301,
  0x2028, 0x20ac, 0x6771, 0xfb33, 0xfeff, 0x1f600, 0x1f469, 0x200d,
]

function randomString(random: () => number): string {
  let s = ''
  const length = Math.floor(random() * 8)
  for (let i = 0; i < length; i++) {
    s += String.fromCodePoint(
      CODE_POINTS[Math.floor(random() * CODE_POINTS.length)]!
    )
  }
  return s
}

function randomJson(random: () => number, depth: number): unknown {
  const pick = Math.floor(random() * (depth > 3 ? 4 : 6))
  switch (pick) {
    case 0:
      return null
    case 1:
      return random() < 0.5
    case 2: {
      const numbers = [0, -0, 1, -1, 0.1, 1e21, 1e-7, 2 ** 53 - 1, 1234.5678]
      return random() < 0.5
        ? numbers[Math.floor(random() * numbers.length)]
        : Math.round((random() - 0.5) * 1e6) / 100
    }
    case 3:
      return randomString(random)
    case 4:
      return Array.from({ length: Math.floor(random() * 4) }, () =>
        randomJson(random, depth + 1)
      )
    default: {
      const out: Record<string, unknown> = {}
      const size = Math.floor(random() * 5)
      for (let i = 0; i < size; i++) {
        out[randomString(random)] = randomJson(random, depth + 1)
      }
      return out
    }
  }
}

describe('shared test vectors', () => {
  test('cover the cases section 1.4 asks for', () => {
    expect(vectors.map((v) => v.name)).toEqual(
      expect.arrayContaining(['nested-marks', 'non-ascii'])
    )
  })

  test.each(vectors)('$name: bytes and content_hash', async (vector) => {
    const input = vector.input as CanonicalArticleInput
    const bytes = canonicalArticleBytes(input)
    expect(utf8(bytes)).toBe(vector.canonical)
    expect(bytes.length).toBe(vector.byteLength)
    expect(await articleContentHashHex(input)).toBe(vector.sha256)
    // Web Crypto and node:crypto agree on the digest.
    expect(nodeSha256(bytes)).toBe(vector.sha256)
    // Input key order does not change the bytes.
    const reordered = reorderKeys(input, prng(7)) as CanonicalArticleInput
    expect(utf8(canonicalArticleBytes(reordered))).toBe(vector.canonical)
  })

  test('Unicode text is not normalised', () => {
    const nfc = vectors.find((v) => v.name === 'unicode-nfc')!
    const nfd = vectors.find((v) => v.name === 'unicode-nfd')!
    expect(nfc.input.title.normalize('NFC')).toBe(
      nfd.input.title.normalize('NFC')
    )
    expect(nfc.sha256).not.toBe(nfd.sha256)
  })

  test('line endings are kept as stored', () => {
    const vector = vectors.find((v) => v.name === 'line-endings-and-controls')!
    expect(vector.canonical).toContain('crlf\\r\\nlf\\ncr\\r end')
    expect(vector.canonical).toContain(' ')
    expect(vector.canonical).toContain('\\u000b')
  })
})

describe('canonicalArticleBytes', () => {
  const base: CanonicalArticleInput = {
    articleId: 'k57f3m2r8w6x1c4v9b0n5p7q3s2t6y8z',
    authorId: 'j97d2h5k1m8n4p6q3r9s0t7v2w5x8y1z',
    title: 'Notes',
    content: { type: 'doc', content: [] },
    contentVersion: 1,
  }

  test('has the schema tag, the five article fields and nothing else', () => {
    const extra = {
      ...base,
      excerpt: 'shown in lists',
      authorUsername: 'writer',
      publishedAt: 1700000000000,
    } as CanonicalArticleInput
    expect(utf8(canonicalArticleBytes(extra))).toBe(
      '{"articleId":"k57f3m2r8w6x1c4v9b0n5p7q3s2t6y8z","authorId":"j97d2h5k1m8n4p6q3r9s0t7v2w5x8y1z","content":{"content":[],"type":"doc"},"contentVersion":1,"schema":"quilltip-article-v1","title":"Notes"}'
    )
    expect(Object.keys(canonicalArticle(extra)).sort()).toEqual([
      'articleId',
      'authorId',
      'content',
      'contentVersion',
      'schema',
      'title',
    ])
    expect(canonicalArticle(base).schema).toBe(ARTICLE_SCHEMA)
  })

  test('the same article gives the same hash on two runs', async () => {
    const first = await articleContentHashHex(base)
    const second = await articleContentHashHex(structuredClone(base))
    expect(second).toBe(first)
    expect(bytesToHex(await articleContentHash(base))).toBe(first)
  })

  test('each covered field changes the hash', async () => {
    const hash = await articleContentHashHex(base)
    for (const change of [
      { articleId: 'other' },
      { authorId: 'other' },
      { title: 'Notes ' },
      { content: { type: 'doc', content: [{ type: 'paragraph' }] } },
      { contentVersion: 2 },
    ]) {
      expect(await articleContentHashHex({ ...base, ...change })).not.toBe(hash)
    }
  })

  test('rejects invalid fields', () => {
    const bad: Array<Partial<CanonicalArticleInput>> = [
      { articleId: '' },
      { authorId: '' },
      { title: undefined },
      { content: undefined },
      { contentVersion: 0 },
      { contentVersion: 1.5 },
      { contentVersion: 2 ** 32 },
    ]
    for (const change of bad) {
      expect(() =>
        canonicalArticleBytes({ ...base, ...change } as CanonicalArticleInput)
      ).toThrow(CanonicalArticleError)
    }
  })

  test('very long content: 4,000 paragraphs of mixed text', async () => {
    const content = {
      type: 'doc',
      content: Array.from({ length: 4000 }, (_, i) => ({
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: `Paragraph ${i}: naïve café, 東京, 🌸, line\r\nbreak.`,
            ...(i % 3 === 0 ? { marks: [{ type: 'bold' }] } : {}),
          },
        ],
      })),
    }
    const input = { ...base, content }
    const bytes = canonicalArticleBytes(input)
    expect(bytes.length).toBe(501_771)
    const hash = await articleContentHashHex(input)
    expect(hash).toBe(nodeSha256(bytes))
    expect(hash).toBe(
      '2475bfba6c74f04e3a12b47f63697329a761a37d662fb1512e218e2aae21d404'
    )
  })
})

describe('canonicalJson (RFC 8785)', () => {
  test('numbers use the ECMAScript form', () => {
    const cases: Array<[number, string]> = [
      [0, '0'],
      [-0, '0'],
      [1, '1'],
      [-1.5, '-1.5'],
      [0.002, '0.002'],
      [0.000001, '0.000001'],
      [1e-7, '1e-7'],
      [1e21, '1e+21'],
      [1e20, '100000000000000000000'],
      [1e30, '1e+30'],
      [333333333.33333329, '333333333.3333333'],
      [9007199254740992, '9007199254740992'],
      [5e-324, '5e-324'],
      [1.7976931348623157e308, '1.7976931348623157e+308'],
    ]
    for (const [value, text] of cases) expect(canonicalJson(value)).toBe(text)
  })

  test('sorts keys by UTF-16 code units (section 3.2.3 example)', () => {
    const input = {
      '€': 'Euro Sign',
      '\r': 'Carriage Return',
      דּ: 'Hebrew Letter Dalet With Dagesh',
      '1': 'One',
      '😀': 'Emoji: Grinning Face',
      '\u0080': 'Control',
      ö: 'Latin Small Letter O With Diaeresis',
    }
    // Read the order from the text: JSON.parse would move "1" first.
    const text = canonicalJson(input)
    const order = Object.values(input).sort(
      (a, b) => text.indexOf(`"${a}"`) - text.indexOf(`"${b}"`)
    )
    expect(order).toEqual([
      'Carriage Return',
      'One',
      'Control',
      'Latin Small Letter O With Diaeresis',
      'Euro Sign',
      'Emoji: Grinning Face',
      'Hebrew Letter Dalet With Dagesh',
    ])
  })

  test('serialises the section 3.2.2 example', () => {
    const input = {
      numbers: [
        333333333.33333329, 1e30, 4.5, 2e-3, 0.000000000000000000000000001,
      ],
      // €, $, U+000F, LF, A, ', B, ", \, \, ", /
      string: ['€$', '\u000f', '\n', "A'B", '"', '\\', '\\', '"', '/'].join(''),
      literals: [null, true, false],
    }
    expect(canonicalJson(input)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}'
    )
  })

  test('rejects values outside I-JSON', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    const bad: unknown[] = [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      '\ud800',
      'a\udc00b',
      { '\ud83d': 1 },
      undefined,
      { a: undefined },
      [undefined],
      () => 1,
      Symbol('x'),
      BigInt(1),
      new Date(0),
      new Map(),
      new Uint8Array(1),
      [1, , 3],
      cyclic,
    ]
    for (const value of bad) {
      expect(() => canonicalJson(value)).toThrow(CanonicalJsonError)
    }
  })

  test('a shared, non-cyclic reference is allowed', () => {
    const mark = { type: 'bold' }
    expect(canonicalJson([mark, { marks: [mark] }])).toBe(
      '[{"type":"bold"},{"marks":[{"type":"bold"}]}]'
    )
  })

  test('determinism: 500 random documents', async () => {
    const random = prng(453)
    for (let i = 0; i < 500; i++) {
      const value = randomJson(random, 0)
      const text = canonicalJson(value)
      // Stable across runs and across key insertion order.
      expect(canonicalJson(value)).toBe(text)
      expect(canonicalJson(reorderKeys(value, random))).toBe(text)
      // Canonical output is valid JSON and a fixed point.
      expect(canonicalJson(JSON.parse(text))).toBe(text)
      const input = { ...vectors[0]!.input, content: value }
      const hash = await articleContentHashHex(input as CanonicalArticleInput)
      expect(
        await articleContentHashHex(
          reorderKeys(input, random) as CanonicalArticleInput
        )
      ).toBe(hash)
    }
  })
})

describe('Arweave upload body', () => {
  const input = vectors.find((v) => v.name === 'nested-marks')!
    .input as CanonicalArticleInput

  test('is exactly the canonical bytes and hashes to contentHash', async () => {
    const upload = await buildArticleUpload({
      ...input,
      authorUsername: 'writer',
      uploadedAt: 1_750_000_000_000,
    })
    expect(upload.body).toEqual(canonicalArticleBytes(input))
    expect(upload.contentHash).toBe(await articleContentHashHex(input))
    expect(nodeSha256(upload.body)).toBe(upload.contentHash)
    const tags = Object.fromEntries(upload.tags.map((t) => [t.name, t.value]))
    expect(tags).toMatchObject({
      Schema: ARTICLE_SCHEMA,
      'Article-Id': input.articleId,
      'Content-Version': '1',
      'Content-Hash': upload.contentHash,
      Timestamp: '1750000000000',
    })
  })

  test('upload time and display names stay out of the body', async () => {
    const early = await buildArticleUpload({
      ...input,
      authorUsername: 'writer',
      uploadedAt: 1,
    })
    const late = await buildArticleUpload({
      ...input,
      authorUsername: 'renamed',
      uploadedAt: 2,
    })
    expect(late.body).toEqual(early.body)
    expect(late.contentHash).toBe(early.contentHash)
    expect(utf8(early.body)).not.toContain('writer')
  })
})
