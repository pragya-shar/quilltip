/** Plain text extracted from TipTap/ProseMirror JSON (for word count). */
export function extractTextFromTiptapJson(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const n = node as Record<string, unknown>
  if (n.type === 'text' && typeof n.text === 'string') return n.text
  if (Array.isArray(n.content)) {
    return n.content.map(extractTextFromTiptapJson).join(' ')
  }
  return ''
}
