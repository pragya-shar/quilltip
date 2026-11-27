/**
 * Passage identity (`lib/passages/sentences.ts`) against the shared vectors
 * (`lib/passages/vectors/identity-v1.json`), which the browser tests load too.
 * Runs in the edge runtime that the Convex tests use.
 */
import { afterEach, describe, expect, test } from 'vitest'
import vectors from '../../lib/passages/vectors/identity-v1.json'
import {
  LEGACY_PASSAGE_PREFIX,
  PASSAGE_ID_LENGTH,
  PASSAGE_ID_SCHEME,
  canonicalText,
  findPassage,
  identifyPassage,
  identifyRange,
  legacyPassageOf,
  normalizePassageText,
  passageText,
  rangeOfSentences,
  sentenceRange,
  sentencesOf,
} from '../../lib/passages/sentences'
import {
  extractTextFromTiptapJson,
  resolveCanonicalHighlightPassage,
} from '../../convex/lib/tiptapContent'

const ARTICLE = vectors.articleId

/** The documented formula, computed here without the module's helper. */
async function expectedId(text: string, at?: [number, number]) {
  const input = at
    ? `${PASSAGE_ID_SCHEME}:at\n${ARTICLE}\n${at[0]}:${at[1]}\n${text}`
    : `${PASSAGE_ID_SCHEME}\n${ARTICLE}\n${text}`
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(input)
  )
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, PASSAGE_ID_LENGTH)
}

const para = (...texts: string[]) => ({
  type: 'doc',
  content: texts.map((text) => ({
    type: 'paragraph',
    content: [{ type: 'text', text }],
  })),
})

describe('shared vectors', () => {
  test('use this scheme and id length', () => {
    expect(vectors.scheme).toBe(PASSAGE_ID_SCHEME)
    expect(vectors.idLength).toBe(PASSAGE_ID_LENGTH)
  })

  test.each(vectors.cases)('$name: canonical text and sentences', (c) => {
    const canonical = canonicalText(c.content)
    expect(canonical.text).toBe(c.text)
    expect(
      sentencesOf(canonical).map((s) => ({
        start: s.start,
        end: s.end,
        text: s.text,
      }))
    ).toEqual(c.sentences)
  })

  test.each(vectors.cases)('$name: passage ids', async (c) => {
    const canonical = canonicalText(c.content)
    const sentences = sentencesOf(canonical)
    for (const p of c.passages) {
      const range = rangeOfSentences(sentences, p.sentenceStart, p.sentenceEnd)!
      const id = await identifyRange(ARTICLE, canonical, sentences, range)
      expect(id).toMatchObject({
        passageId: p.passageId,
        text: p.text,
        ambiguous: p.ambiguous,
      })
      const key = normalizePassageText(
        sentences
          .slice(p.sentenceStart, p.sentenceEnd + 1)
          .map((s) => s.text)
          .join(' ')
      )
      expect(p.passageId).toBe(
        await expectedId(
          key,
          p.ambiguous ? [p.sentenceStart, p.sentenceEnd] : undefined
        )
      )
    }
  })

  test.each(vectors.cases)('$name: taps and selections snap', async (c) => {
    const canonical = canonicalText(c.content)
    const sentences = sentencesOf(canonical)
    for (const s of c.selections) {
      const id = await identifyPassage(
        ARTICLE,
        canonical,
        sentences,
        s.start,
        s.end
      )
      expect(id).toMatchObject({
        sentenceStart: s.sentenceStart,
        sentenceEnd: s.sentenceEnd,
        passageId: s.passageId,
      })
    }
  })

  test.each(vectors.cases)(
    '$name: offsets are the highlight offsets of convex/lib/tiptapContent',
    (c) => {
      const canonical = canonicalText(c.content)
      expect(
        canonical.blocks.map((b) => c.text.slice(b.start, b.end)).join(' ')
      ).toBe(extractTextFromTiptapJson(c.content))
      for (const s of sentencesOf(canonical)) {
        const text = passageText(canonical, s.start, s.end)
        expect(() =>
          resolveCanonicalHighlightPassage(c.content, {
            highlightText: text,
            startOffset: s.start,
            endOffset: s.end,
          })
        ).not.toThrow()
      }
    }
  )

  test.each(vectors.edits)('$name', async (e) => {
    expect(e.beforeIds).toHaveLength(1)
    const before = e.beforeIds[0]!
    if (e.expect === 'same') {
      expect(e.afterIds).toHaveLength(1)
      expect(e.afterIds[0]!.passageId).toBe(before.passageId)
      expect(e.afterIds[0]!.sentenceStart).not.toBe(before.sentenceStart)
    } else if (e.expect === 'different') {
      expect(e.afterIds).toHaveLength(1)
      expect(e.afterIds[0]!.passageId).not.toBe(before.passageId)
    } else {
      expect(e.afterIds.length).toBeGreaterThan(1)
      const ids = new Set(e.afterIds.map((x) => x.passageId))
      expect(ids.size).toBe(e.afterIds.length)
      expect(ids.has(before.passageId)).toBe(false)
      expect(e.afterIds.every((x) => x.ambiguous)).toBe(true)
    }
    // The vector's ids are what the module computes now.
    for (const [content, ids, sentence] of [
      [e.before, e.beforeIds, e.sentence],
      [e.after, e.afterIds, e.afterSentence ?? e.sentence],
    ] as const) {
      const canonical = canonicalText(content)
      const sentences = sentencesOf(canonical)
      const hits = sentences.filter((s) => s.text === sentence)
      const got = await Promise.all(
        hits.map(
          async (s) =>
            (
              await identifyRange(
                ARTICLE,
                canonical,
                sentences,
                rangeOfSentences(sentences, s.index, s.index)!
              )
            ).passageId
        )
      )
      expect(got).toEqual(ids.map((x) => x.passageId))
    }
  })

  test('decomposed and precomposed accents give the same id', () => {
    const [a, b] = vectors.cases.filter((c) => c.name.includes('accent'))
    expect(a!.passages.map((p) => p.passageId)).toEqual(
      b!.passages.map((p) => p.passageId)
    )
    expect(a!.text).not.toBe(b!.text)
  })
})

describe('vector notes and normalisation', () => {
  test('every case says what the rule does', () => {
    for (const c of vectors.cases) expect(c.note.length).toBeGreaterThan(10)
  })

  test('quotes are kept as written: straight and curly apostrophes differ', () => {
    const [straight, curly] = ['straight apostrophe', 'curly apostrophe'].map(
      (name) => vectors.cases.find((c) => c.name === name)!
    )
    expect(straight!.passages[0]!.passageId).not.toBe(
      curly!.passages[0]!.passageId
    )
  })

  test('normalisation: NFC, whitespace runs to one space, trimmed, case kept', () => {
    expect(normalizePassageText(' A\u00A0\u2028b\t\nC\uFEFF ')).toBe('A b C')
    expect(normalizePassageText('Cafe\u0301')).toBe('Caf\u00E9')
    expect(normalizePassageText('It\u2019s \u2014 "x"')).toBe(
      'It\u2019s \u2014 "x"'
    )
    expect(normalizePassageText('MiXeD')).toBe('MiXeD')
  })
})

describe('no Intl.Segmenter', () => {
  const intl = Intl as unknown as Record<string, unknown>
  const original = intl.Segmenter
  afterEach(() => {
    intl.Segmenter = original
  })

  test('the module gives the same sentences with the segmenter missing or broken', () => {
    const expected = vectors.cases.map((c) =>
      sentencesOf(canonicalText(c.content)).map((s) => s.text)
    )
    intl.Segmenter = undefined
    expect(
      vectors.cases.map((c) =>
        sentencesOf(canonicalText(c.content)).map((s) => s.text)
      )
    ).toEqual(expected)
    intl.Segmenter = function () {
      throw new Error('Intl.Segmenter must not be used')
    }
    expect(
      vectors.cases.map((c) =>
        sentencesOf(canonicalText(c.content)).map((s) => s.text)
      )
    ).toEqual(expected)
  })
})

describe('snapping', () => {
  const content = para('First one here. Second one here.', 'Third one.')
  const canonical = canonicalText(content)
  const sentences = sentencesOf(canonical)

  test('a selection inside one sentence snaps to it', () => {
    expect(sentenceRange(sentences, 2, 5)).toEqual({
      sentenceStart: 0,
      sentenceEnd: 0,
      startOffset: 0,
      endOffset: 15,
    })
  })

  test('a selection across sentences and blocks covers them whole', async () => {
    const id = await identifyPassage(ARTICLE, canonical, sentences, 20, 35)
    expect(id).toMatchObject({ sentenceStart: 1, sentenceEnd: 2 })
    expect(id!.text).toBe('Second one here. Third one.')
  })

  test('two selections of the same sentence give one id', async () => {
    const a = await identifyPassage(ARTICLE, canonical, sentences, 16, 18)
    const b = await identifyPassage(ARTICLE, canonical, sentences, 25, 31)
    expect(a!.passageId).toBe(b!.passageId)
  })

  test('whitespace, an empty range at a gap and out-of-range offsets give no passage', () => {
    expect(sentenceRange(sentences, 15, 16)).toBeNull()
    expect(sentenceRange(sentences, 15, 15)).toBeNull()
    expect(sentenceRange(sentences, 500, 600)).toBeNull()
    expect(sentenceRange(sentences, 5, 2)).toBeNull()
    expect(sentenceRange(sentences, Number.NaN, 3)).toBeNull()
  })

  test('the same article id is needed for the same passage id', async () => {
    const a = await identifyPassage(ARTICLE, canonical, sentences, 0, 3)
    const b = await identifyPassage('another', canonical, sentences, 0, 3)
    expect(a!.passageId).not.toBe(b!.passageId)
  })

  test('findPassage matches word for word only', () => {
    expect(findPassage(sentences, 'Second one here.')).toEqual([[1, 1]])
    expect(findPassage(sentences, 'Second  one\nhere.')).toEqual([[1, 1]])
    expect(findPassage(sentences, 'Second one there.')).toEqual([])
    expect(findPassage(sentences, 'Second one')).toEqual([])
    expect(findPassage(sentences, 'Second one here. Third one.')).toEqual([
      [1, 2],
    ])
  })
})

describe('legacyPassageOf', () => {
  const content = para('Alpha beta gamma. Delta epsilon.')
  const article = { _id: ARTICLE, content }

  test('a row whose text still matches joins the snapped passage', async () => {
    const snapped = await identifyPassage(
      ARTICLE,
      canonicalText(content),
      sentencesOf(canonicalText(content)),
      6,
      10
    )
    expect(
      await legacyPassageOf(
        { highlightId: 'h1', text: 'beta', startOffset: 6, endOffset: 10 },
        article
      )
    ).toEqual({
      passageId: snapped!.passageId,
      range: {
        sentenceStart: 0,
        sentenceEnd: 0,
        startOffset: 0,
        endOffset: 17,
      },
    })
  })

  test('a row from an edited article keeps a passage of its own', async () => {
    expect(
      await legacyPassageOf(
        { highlightId: 'h2', text: 'zeta', startOffset: 6, endOffset: 10 },
        article
      )
    ).toEqual({ passageId: `${LEGACY_PASSAGE_PREFIX}h2`, range: null })
  })

  test.each([
    { startOffset: undefined, endOffset: undefined },
    { startOffset: null, endOffset: 4 },
    { startOffset: -1, endOffset: 4 },
    { startOffset: 4, endOffset: 4 },
    { startOffset: 0, endOffset: 9999 },
  ])(
    'unknown or impossible offsets keep a passage of their own: %j',
    async (o) => {
      expect(
        await legacyPassageOf(
          { highlightId: 'h3', text: 'Alpha', ...o },
          article
        )
      ).toEqual({ passageId: `${LEGACY_PASSAGE_PREFIX}h3`, range: null })
    }
  )
})
