import { extractTextFromTiptapJson } from '../../convex/lib/tiptapContent'

const sentenceSegmenter = new Intl.Segmenter('en', { granularity: 'sentence' })

export function getArticleOpening(article: {
  excerpt?: string | null
  content?: unknown
}): string {
  const text = (
    extractTextFromTiptapJson(article.content) ||
    article.excerpt ||
    ''
  )
    .replace(/\s+/g, ' ')
    .trim()
  const sentence =
    sentenceSegmenter
      .segment(text)
      [Symbol.iterator]()
      .next()
      .value?.segment.trim() ?? ''
  if (sentence.length <= 160) return sentence
  const prefix = sentence.slice(0, 159)
  const boundary = prefix.lastIndexOf(' ')
  return `${boundary > 0 ? prefix.slice(0, boundary) : prefix}…`
}
