/** Plain text extracted from TipTap/ProseMirror JSON (for validation and read time). */
export function extractTextFromTiptapJson(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const n = node as Record<string, unknown>
  if (n.type === 'text' && typeof n.text === 'string') return n.text
  if (Array.isArray(n.content)) {
    return n.content.map(extractTextFromTiptapJson).join(' ')
  }
  return ''
}

export function tiptapJsonHasNonEmptyText(content: unknown): boolean {
  return extractTextFromTiptapJson(content).trim().length > 0
}
