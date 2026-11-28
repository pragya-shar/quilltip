import { describe, expect, it } from 'vitest'
import {
  changedFaces,
  heldFailures,
  upgradeFailures,
  type Run,
} from './font-gates'

const run = (key: string, font: string, width: number): Run => ({
  key,
  width,
  font,
  family: font.startsWith('readingItalic')
    ? 'readingItalicFace, "Quilltip Read Italic Fallback"'
    : font.startsWith('reading')
      ? 'readingFace, "Quilltip Read Fallback"'
      : 'system-ui',
})
const cached = [
  run('p#0', 'readingFace 400 normal', 1654.6),
  run('em#0', 'readingItalicFace 400 italic', 148.2),
  run('nav#0', 'Quilltip UI 400 normal', 50),
]

describe('the next page view gate', () => {
  it('passes when every reading font is at its web-font width', () => {
    expect(upgradeFailures('x', cached, cached)).toEqual([])
  })

  it('fails on one font that did not upgrade, even when the total is close', () => {
    // A long roman text hides a short italic in the sum.
    const next = [
      run('p#0', 'readingFace 400 normal', 1654.6),
      run('em#0', 'readingItalicFace 400 italic', 144.5),
    ]
    expect(upgradeFailures('x', next, cached)).toEqual([
      'x: text in readingItalicFace 400 italic is 0.975 times its width in the web fonts (not upgraded)',
    ])
  })

  it('holds to 0.2 percent', () => {
    const next = [run('p#0', 'readingFace 400 normal', 1654.6 * 1.003)]
    expect(upgradeFailures('x', next, cached)).toHaveLength(1)
    const close = [run('p#0', 'readingFace 400 normal', 1654.6 * 1.0015)]
    expect(upgradeFailures('x', close, cached)).toEqual([])
  })

  it('fails when nothing was measured', () => {
    expect(upgradeFailures('x', undefined, cached)).toEqual(['x: not measured'])
    expect(
      upgradeFailures('x', [run('nav#0', 'Quilltip UI 400 normal', 50)], cached)
    ).toEqual(['x: no reading text measured'])
  })
})

describe('a face change inside a view', () => {
  it('is found in a reading font with no re-wrap', () => {
    const before = [run('p#0', 'readingFace 400 normal', 1621.7)]
    const after = [run('p#0', 'readingFace 400 normal', 1654.6)]
    expect(changedFaces(before, after).map((c) => c.font)).toEqual([
      'readingFace 400 normal',
    ])
    expect(changedFaces(before, before)).toEqual([])
  })

  it('ignores the interface face', () => {
    const before = [run('nav#0', 'Quilltip UI 400 normal', 50)]
    const after = [run('nav#0', 'Quilltip UI 400 normal', 80)]
    expect(changedFaces(before, after)).toEqual([])
  })
})

describe('a late view that held nothing', () => {
  it('fails when the case needs a held request', () => {
    expect(heldFailures('x', 0, true)).toHaveLength(1)
    expect(heldFailures('x', 2, true)).toEqual([])
    expect(heldFailures('x', 0, false)).toEqual([])
  })
})
