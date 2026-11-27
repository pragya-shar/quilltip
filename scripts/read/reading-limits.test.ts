import { describe, expect, it } from 'vitest'
import { readingPlainText } from '@/lib/tiptap/readingPlainText'
import { renderReadingHtml } from '@/lib/tiptap/renderReadingHtml'
import { READING_LIMITS } from '@/lib/tiptap/sanitizeReadingDoc'

// Oversized documents are refused, quickly, not rendered slowly: the
// renderer reports `unavailable: 'too-large'` and the page shows its
// not-available state.

const text = (t: string) => ({ type: 'text', text: t })
const p = (t: string) => ({ type: 'paragraph', content: [text(t)] })

function nested(levels: number) {
  let node: object = p('Deep.')
  for (let i = 0; i < levels; i++)
    node = { type: 'blockquote', content: [node] }
  return { type: 'doc', content: [node] }
}

/** Runs `render`, returning its result and how long it took. */
function timed<T>(render: () => T) {
  const start = performance.now()
  const value = render()
  return { value, ms: performance.now() - start }
}

describe('reading limits', () => {
  it('renders a document inside every limit', () => {
    const doc = nested(READING_LIMITS.depth - 4)
    expect(renderReadingHtml(doc).html).toContain('Deep.')
  })

  it('refuses a document nested too deeply, at once', () => {
    const { value, ms } = timed(() => renderReadingHtml(nested(5_000)))
    expect(value).toEqual({
      html: undefined,
      headings: [],
      unavailable: 'too-large',
    })
    expect(ms).toBeLessThan(250)
  })

  it('refuses too many nodes, at once', () => {
    const doc = {
      type: 'doc',
      content: Array.from({ length: READING_LIMITS.nodes }, () => p('x')),
    }
    const { value, ms } = timed(() => renderReadingHtml(doc))
    expect(value).toMatchObject({ unavailable: 'too-large' })
    expect(ms).toBeLessThan(500)
  })

  it('refuses one text node past its length', () => {
    const doc = {
      type: 'doc',
      content: [p('a'.repeat(READING_LIMITS.textLength + 1))],
    }
    expect(renderReadingHtml(doc)).toMatchObject({ unavailable: 'too-large' })
  })

  it('drops a link or an image whose address is too long, and keeps the text', () => {
    const long = `https://e.example/${'a'.repeat(READING_LIMITS.urlLength)}`
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'linked',
              marks: [{ type: 'link', attrs: { href: long } }],
            },
          ],
        },
        { type: 'resizableImage', attrs: { src: long } },
      ],
    }
    expect(renderReadingHtml(doc)).toEqual({
      html: '<p id="s-0-0">linked</p>',
      headings: [],
    })
  })

  it('reads a description within the limits, and none from an oversized document', () => {
    expect(
      readingPlainText({ type: 'doc', content: [p('One.'), p('Two.')] })
    ).toBe('One. Two.')
    expect(readingPlainText(nested(5_000))).toBe('')
    expect(
      readingPlainText({ type: 'doc', content: [p('x'.repeat(900))] }, 20)
    ).toHaveLength(20)
  })
})
