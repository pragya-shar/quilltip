export const DEFAULT_WORDS_PER_MINUTE = 200

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
