function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object'
}

function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
  return base || 'section'
}

function extractPlainText(node: unknown): string {
  if (!isRecord(node)) return ''
  if (node.type === 'text' && typeof node.text === 'string') return node.text
  if (Array.isArray(node.content)) {
    return node.content.map(extractPlainText).join(' ').trim()
  }
  return ''
}

export type TocHeading = {
  id: string
  text: string
  level: 2
}

export function extractH2HeadingsFromTiptapJson(
  content: unknown
): TocHeading[] {
  const headings: Omit<TocHeading, 'id'>[] = []

  const walk = (node: unknown) => {
    if (!isRecord(node)) return

    if (node.type === 'heading' && node.attrs && isRecord(node.attrs)) {
      const level = node.attrs.level
      if (level === 2) {
        const text = extractPlainText(node).replace(/\s+/g, ' ').trim()
        if (text) headings.push({ text, level: 2 })
      }
    }

    if (Array.isArray(node.content)) {
      node.content.forEach(walk)
    }
  }

  walk(content)

  const seen = new Map<string, number>()
  return headings.map((h) => {
    const base = slugify(h.text)
    const count = (seen.get(base) ?? 0) + 1
    seen.set(base, count)
    const id = count === 1 ? base : `${base}-${count}`
    return { ...h, id }
  })
}

/**
 * Gives each level-2 heading in rendered article HTML the id of its table of
 * contents entry, in document order, so `#section` links work in the server
 * HTML with no script. `headings` is `extractH2HeadingsFromTiptapJson` of the
 * same document; extra headings in the HTML keep no id.
 */
export function withHeadingIds(html: string, headings: TocHeading[]): string {
  let index = 0
  return html.replace(/<h2(\s[^>]*)?>/g, (tag, attrs: string | undefined) => {
    const heading = headings[index++]
    if (!heading || /\sid=/.test(attrs ?? '')) return tag
    return `<h2 id="${heading.id}"${attrs ?? ''}>`
  })
}
