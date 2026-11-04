export const DEFAULT_WORDS_PER_MINUTE = 200

/** Match the writing desk's TipTap text: marks don't split words; blocks and hard breaks do. */
function articleReadingText(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const n = node as Record<string, unknown>
  if (n.type === 'text' && typeof n.text === 'string') return n.text
  if (n.type === 'hardBreak') return '\n'
  if (!Array.isArray(n.content)) return ''
  const isTextBlock =
    n.type === 'paragraph' || n.type === 'heading' || n.type === 'codeBlock'
  return n.content.map(articleReadingText).join(isTextBlock ? '' : '\n\n')
}

export function estimateArticleReadingMinutes(content: unknown): number {
  return estimateReadingMinutes(articleReadingText(content))
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

export function estimateReadingMinutesFromWordCount(
  wordCount: number,
  wordsPerMinute: number = DEFAULT_WORDS_PER_MINUTE
): number {
  if (!Number.isFinite(wordCount) || wordCount <= 0) return 1
  return Math.max(1, Math.ceil(wordCount / wordsPerMinute))
}

export function estimateReadingMinutes(
  text: string,
  wordsPerMinute: number = DEFAULT_WORDS_PER_MINUTE
): number {
  return estimateReadingMinutesFromWordCount(countWords(text), wordsPerMinute)
}
