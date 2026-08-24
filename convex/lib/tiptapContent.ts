type TiptapNode = Record<string, unknown>

type TextSegment = {
  text: string
  textStart: number
  textEnd: number
  documentStart: number
  blockKey: string
}

export type CanonicalHighlightPassage = {
  highlightText: string
  startOffset: number
  endOffset: number
  startContainerPath: string
  endContainerPath: string
}

const TEXT_CONTAINER_PATH_PATTERN = /^text\.(\d+)$/
const TEXT_BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'codeBlock',
  'listItem',
])
const STRUCTURAL_NODE_TYPES = new Set([
  ...TEXT_BLOCK_TYPES,
  'blockquote',
  'bulletList',
  'orderedList',
])

function collectTextSegments(node: unknown): TextSegment[] {
  const segments: TextSegment[] = []
  let textOffset = 0

  const visit = (
    current: unknown,
    documentStart: number,
    parentBlockKey: string,
    isRoot = false
  ): number => {
    if (!current || typeof current !== 'object') return 0
    const record = current as TiptapNode
    if (record.type === 'text' && typeof record.text === 'string') {
      const text = record.text
      segments.push({
        text,
        textStart: textOffset,
        textEnd: textOffset + text.length,
        documentStart,
        blockKey: parentBlockKey,
      })
      textOffset += text.length
      return text.length
    }

    const content = Array.isArray(record.content) ? record.content : []
    if (content.length === 0) {
      return isRoot
        ? 0
        : typeof record.type === 'string' &&
            STRUCTURAL_NODE_TYPES.has(record.type)
          ? 2
          : 1
    }

    const ownBlockKey =
      typeof record.type === 'string' && TEXT_BLOCK_TYPES.has(record.type)
        ? `${record.type}:${documentStart}`
        : parentBlockKey
    let contentSize = 0
    for (const child of content) {
      const childStart = isRoot
        ? documentStart + contentSize
        : documentStart + 1 + contentSize
      contentSize += visit(child, childStart, ownBlockKey)
    }
    return isRoot ? contentSize : contentSize + 2
  }

  visit(node, 0, 'doc', true)
  return segments
}

function textFromSegments(segments: TextSegment[]): string {
  let text = ''
  let previousBlockKey: string | undefined
  for (const segment of segments) {
    if (previousBlockKey && previousBlockKey !== segment.blockKey) text += ' '
    text += segment.text
    previousBlockKey = segment.blockKey
  }
  return text
}

/** Plain text extracted from TipTap/ProseMirror JSON (for validation and read time). */
export function extractTextFromTiptapJson(node: unknown): string {
  return textFromSegments(collectTextSegments(node))
}

function pathPosition(path: string | undefined): number | null {
  if (path === undefined) return null
  const match = TEXT_CONTAINER_PATH_PATTERN.exec(path)
  if (!match?.[1]) return Number.NaN
  return Number(match[1])
}

function boundaryPosition(
  segments: TextSegment[],
  offset: number,
  boundary: 'start' | 'end'
): number | null {
  const segment = segments.find((candidate) =>
    boundary === 'start'
      ? offset >= candidate.textStart && offset < candidate.textEnd
      : offset > candidate.textStart && offset <= candidate.textEnd
  )
  if (!segment) return null
  return segment.documentStart + offset - segment.textStart
}

export function resolveCanonicalHighlightPassage(
  content: unknown,
  selection: {
    highlightText: string
    startOffset: number
    endOffset: number
    startContainerPath?: string
    endContainerPath?: string
  }
): CanonicalHighlightPassage {
  const segments = collectTextSegments(content)
  const totalTextLength = segments.at(-1)?.textEnd ?? 0
  if (
    !Number.isSafeInteger(selection.startOffset) ||
    !Number.isSafeInteger(selection.endOffset) ||
    selection.startOffset < 0 ||
    selection.endOffset <= selection.startOffset ||
    selection.endOffset > totalTextLength
  ) {
    throw new Error('Invalid highlight selection bounds')
  }

  const startPosition = boundaryPosition(
    segments,
    selection.startOffset,
    'start'
  )
  const endPosition = boundaryPosition(segments, selection.endOffset, 'end')
  if (startPosition === null || endPosition === null) {
    throw new Error('Highlight selection cannot be resolved in article content')
  }

  const startContainerPath = `text.${startPosition}`
  const endContainerPath = `text.${endPosition}`
  const suppliedStartPosition = pathPosition(selection.startContainerPath)
  const suppliedEndPosition = pathPosition(selection.endContainerPath)
  if (
    (selection.startContainerPath === undefined) !==
      (selection.endContainerPath === undefined) ||
    (suppliedStartPosition !== null &&
      suppliedStartPosition !== startPosition) ||
    (suppliedEndPosition !== null && suppliedEndPosition !== endPosition)
  ) {
    throw new Error('Highlight coordinate hints do not match article content')
  }

  const selectedSegments = segments
    .filter(
      (segment) =>
        selection.endOffset > segment.textStart &&
        selection.startOffset < segment.textEnd
    )
    .map((segment) => ({
      ...segment,
      text: segment.text.slice(
        Math.max(0, selection.startOffset - segment.textStart),
        Math.min(segment.text.length, selection.endOffset - segment.textStart)
      ),
    }))
  const highlightText = textFromSegments(selectedSegments)
  if (highlightText !== selection.highlightText) {
    throw new Error(
      'Highlight text does not match the selected article passage'
    )
  }

  return {
    highlightText,
    startOffset: selection.startOffset,
    endOffset: selection.endOffset,
    startContainerPath,
    endContainerPath,
  }
}

export function tiptapJsonHasNonEmptyText(content: unknown): boolean {
  return extractTextFromTiptapJson(content).trim().length > 0
}
