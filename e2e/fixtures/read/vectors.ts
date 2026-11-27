// The shared sentence vectors, run in the browser engine: the rule on the
// document, and the view's own path on the rendered HTML (the text nodes the
// page holds). The read suite compares both with the vectors, in Chromium
// and in WebKit, so a difference between engines fails a test.
import { lineSentences } from '../../../hooks/read/passageOffsets'
import { canonicalText, sentencesOf } from '../../../hooks/read/sentenceRule'

type Case = { name: string; content: unknown; html: string | null }
type Result = {
  name: string
  rule: { start: number; end: number; text: string }[]
  view: string[] | null
}

declare global {
  interface Window {
    __VECTORS__: Case[]
    __runVectors: () => Result[]
  }
}

window.__runVectors = () =>
  window.__VECTORS__.map(({ name, content, html }) => {
    const rule = sentencesOf(canonicalText(content)).map(
      ({ start, end, text }) => ({ start, end, text })
    )
    if (html === null) return { name, rule, view: null }
    const root = document.createElement('div')
    root.innerHTML = html
    document.body.append(root)
    const view = lineSentences(root).map((passage) => passage.text)
    root.remove()
    return { name, rule, view }
  })
