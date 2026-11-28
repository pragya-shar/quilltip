// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  blockText,
  choosePassage,
  offsetOf,
  rangeAt,
  textBetween,
  textNodes,
} from '@/hooks/read/passageOffsets'

// The body as renderArticleHtml writes it: no whitespace between blocks,
// marks split text nodes, a captioned image between paragraphs.
const HTML =
  '<h2 id="start">The start</h2>' +
  '<p>She kept a ledger. It was <em>green</em> cloth. Every evening she wrote.</p>' +
  '<figure><img src="x.jpg" alt=""><figcaption contenteditable="false">A caption.</figcaption></figure>' +
  '<ul><li><p>Two pesos to the boy.</p></li><li><p>A peso for the bus. One more.</p></li></ul>' +
  '<blockquote><p>Money moves faster than it used to. It rarely remembers anyone.</p></blockquote>'

let root: HTMLElement
beforeEach(() => {
  document.body.innerHTML = `<div id="read-body">${HTML}</div>`
  root = document.getElementById('read-body')!
})

const full = () =>
  textNodes(root)
    .map((n) => n.data)
    .join('')
const textNode = (needle: string) =>
  textNodes(root).find((n) => n.data.includes(needle))!
const point = (needle: string, inside = 0) => {
  const node = textNode(needle)
  return { node, offset: node.data.indexOf(needle) + inside }
}

describe('text offsets', () => {
  it('count document text only: captions are skipped', () => {
    expect(full()).not.toContain('A caption.')
    expect(full().startsWith('The startShe kept a ledger.')).toBe(true)
  })

  it('map a DOM point to its offset and back', () => {
    const p = point('green', 2)
    const offset = offsetOf(root, p.node, p.offset)!
    expect(full().slice(offset, offset + 3)).toBe('een')
    const range = rangeAt(root, offset, offset + 3)
    expect(range.toString()).toBe('een')
  })

  it('map an element boundary to the text before it', () => {
    const list = root.querySelector('ul')!
    const offset = offsetOf(root, list, 0)!
    expect(full().slice(offset).startsWith('Two pesos')).toBe(true)
  })

  it('give null for a point outside the body', () => {
    expect(offsetOf(root, document.body, 0)).toBeNull()
  })

  it('a range on a node boundary holds no empty edge', () => {
    const start = full().indexOf('green')
    const range = rangeAt(root, start, start + 5)
    expect(range.startContainer.textContent).toBe('green')
    expect(range.toString()).toBe('green')
  })

  it('read a block and the words between blocks with a space', () => {
    const p = root.querySelector('li p')!
    const { start, text } = blockText(root, p)
    expect(text).toBe('Two pesos to the boy.')
    expect(full().slice(start, start + text.length)).toBe(text)
    const end = full().indexOf('bus.') + 4
    expect(textBetween(root, start, end)).toBe(
      'Two pesos to the boy. A peso for the bus.'
    )
  })
})

describe('choosing a line', () => {
  it('a tap chooses the sentence, across inline marks', () => {
    const chosen = choosePassage(root, point('cloth', 1))!
    expect(chosen.text).toBe('It was green cloth.')
    expect(full().slice(chosen.startOffset, chosen.endOffset)).toBe(
      'It was green cloth.'
    )
    expect(chosen.startContainerPath).toBe(`text.${chosen.startOffset}`)
  })

  it('a tap in a quote or a list item chooses a line there', () => {
    expect(choosePassage(root, point('rarely', 0))!.text).toBe(
      'It rarely remembers anyone.'
    )
    expect(choosePassage(root, point('peso for', 0))!.text).toBe(
      'A peso for the bus.'
    )
  })

  it('a heading or a caption is not a line', () => {
    expect(choosePassage(root, point('The start', 2))).toBeNull()
    const caption = root.querySelector('figcaption')!.firstChild!
    expect(choosePassage(root, { node: caption, offset: 1 })).toBeNull()
  })

  it('a selection snaps to the whole sentences it touches', () => {
    const chosen = choosePassage(root, point('ledger', 2), point('green', 1))!
    expect(chosen.text).toBe('She kept a ledger. It was green cloth.')
  })

  it('a selection across paragraphs snaps both ends', () => {
    const chosen = choosePassage(root, point('boy', 1), point('bus', 1))!
    expect(chosen.text).toBe('Two pesos to the boy. A peso for the bus.')
  })
})

describe('the sentence at a line', () => {
  it('is the first sentence at or below the line', async () => {
    const { sentenceAtLine } = await import('@/hooks/read/passageOffsets')
    // happy-dom gives every box zero size: the first line block's first
    // sentence is at or below any line at 0.
    expect(sentenceAtLine(root, 0)?.text).toBe('She kept a ledger.')
  })
})

describe('canonically equivalent text', () => {
  it('splits a decomposed paragraph where the stored-text rule does', async () => {
    const { lineSentences } = await import('@/hooks/read/passageOffsets')
    const { canonicalText, sentencesOf } =
      await import('@/hooks/read/sentenceRule')
    for (const text of [
      'Café au lait. Next one.',
      'Café au lait. Next one.',
      'Mme. Léa came. She sat.',
      'ṕ. 5 is here. Then more.',
    ]) {
      const root = document.createElement('div')
      root.innerHTML = `<p>${text}</p>`
      document.body.append(root)
      const view = lineSentences(root).map((p) => [p.startOffset, p.endOffset])
      const rule = sentencesOf(
        canonicalText({
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
        })
      ).map((s) => [s.start, s.end])
      expect(view, text).toEqual(rule)
      root.remove()
    }
  })
})
