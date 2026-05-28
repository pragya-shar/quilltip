import { Mark, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { HighlightConverter } from '@/lib/highlights/HighlightConverter'

export interface HighlightAttributes {
  id: string
  color: string
  userId: string
  userName?: string
  userAvatar?: string
  note?: string
  createdAt: number
  overlapCount?: number
  startOffset?: number
  endOffset?: number
}

export interface HighlightOptions {
  HTMLAttributes: Record<string, string | number | boolean>
  multicolor: boolean
  highlights: HighlightAttributes[]
  onHighlightClick?: (highlight: HighlightAttributes, event: MouseEvent) => void
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    highlight: {
      setHighlight: (attributes?: HighlightAttributes) => ReturnType
      toggleHighlight: (attributes?: HighlightAttributes) => ReturnType
      unsetHighlight: () => ReturnType
    }
  }
}

/** Escape a string for use as a CSS custom property value. */
export function cssStringValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** Parse --highlight-user-name from inline style (or legacy data attribute). */
export function parseHighlightUserNameFromElement(
  element: HTMLElement
): string | null {
  const legacy = element.getAttribute('data-user-name')
  if (legacy) return legacy

  const style = element.getAttribute('style') ?? ''
  const quoted = style.match(/--highlight-user-name:\s*"((?:[^"\\]|\\.)*)"/)
  if (quoted?.[1]) {
    return quoted[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  const unquoted = style.match(/--highlight-user-name:\s*([^;]+)/)
  if (unquoted?.[1]) {
    return unquoted[1].trim()
  }
  return null
}

/** Default tint strength for a single highlight mark (matches highlights.css). */
export const HIGHLIGHT_READ_MIX_DEFAULT = '18%'

/** Muted RGB for in-article marks (~35% toward neutral); picker hex unchanged in DB. */
export const HIGHLIGHT_READ_RGB_MAP: Record<string, string> = {
  '#F59E0B': '204, 148, 52',
  '#10B981': '89, 162, 118',
  '#3B82F6': '104, 133, 210',
  '#F43F5E': '189, 89, 96',
  '#8B5CF6': '134, 108, 210',
  '#FB7185': '201, 114, 128',
  '#FFEB3B': '210, 198, 88',
  '#FFB3BA': '210, 178, 181',
  '#BAE1FF': '178, 198, 210',
  '#BAFFC9': '178, 210, 188',
  '#FFD9BA': '210, 198, 178',
  '#E8BAFF': '198, 178, 210',
  '#B2FF59': '178, 210, 128',
  '#40C4FF': '128, 178, 210',
  '#FF4081': '210, 128, 158',
  '#E040FB': '198, 128, 210',
  '#FFAB40': '210, 178, 128',
}

/** Build inline style for highlight marks (visual only, not screen-reader metadata). */
export function buildHighlightMarkStyle(attributes: {
  color?: string | null
  userName?: string | null
}): string | undefined {
  const parts: string[] = []
  if (attributes.color) {
    parts.push(`--highlight-color: ${attributes.color}`)
    parts.push(`--highlight-color-rgb: ${getColorRgb(attributes.color)}`)
    parts.push(`--highlight-mix: ${HIGHLIGHT_READ_MIX_DEFAULT}`)
  }
  if (attributes.userName) {
    parts.push(`--highlight-user-name: ${cssStringValue(attributes.userName)}`)
  }
  return parts.length > 0 ? `${parts.join('; ')};` : undefined
}

/** Accessible name for the focusable highlight control (not the mark). */
export function buildHighlightAriaLabel(attrs: {
  userName?: string | null
  note?: string | null
}): string {
  const creator = attrs.userName || 'Anonymous'
  let label = `Highlight by ${creator}`
  if (attrs.note) {
    label += `. Note: ${attrs.note}`
  }
  return label
}

export function createHighlightControlButton(
  attrs: HighlightAttributes,
  onHighlightClick?: (highlight: HighlightAttributes, event: MouseEvent) => void
): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'highlight-attribution-control'
  button.setAttribute('aria-label', buildHighlightAriaLabel(attrs))

  if (!onHighlightClick) {
    return button
  }

  const activate = (event: Event) => {
    event.preventDefault()
    event.stopPropagation()
    onHighlightClick(attrs, event as MouseEvent)
  }

  button.addEventListener('click', activate)
  button.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      activate(event)
    }
  })

  return button
}

/** Muted RGB for mark backgrounds; normalizes hex case for lookup. */
export function getColorRgb(hexColor: string): string {
  const normalized = hexColor.toUpperCase()
  return HIGHLIGHT_READ_RGB_MAP[normalized] ?? '210, 198, 88'
}

// Overlap detection helper
class HighlightOverlapManager {
  private highlights: Map<string, { start: number; end: number }> = new Map()

  addHighlight(id: string, start: number, end: number) {
    this.highlights.set(id, { start, end })
  }

  getOverlapCount(start: number, end: number): number {
    let count = 0
    this.highlights.forEach((highlight) => {
      if (start < highlight.end && end > highlight.start) {
        count++
      }
    })
    return Math.min(count, 5) // Cap at 5 for visual clarity
  }

  clear() {
    this.highlights.clear()
  }
}

const HighlightExtension = Mark.create<HighlightOptions>({
  name: 'highlight',

  addOptions() {
    return {
      multicolor: true,
      HTMLAttributes: {},
      highlights: [],
      onHighlightClick: undefined,
    }
  },

  addAttributes() {
    if (!this.options.multicolor) {
      return {}
    }

    return {
      id: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-highlight-id'),
        renderHTML: (attributes) => {
          if (!attributes.id) {
            return {}
          }
          return {
            'data-highlight-id': attributes.id,
          }
        },
      },
      color: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute('data-color') || element.style.backgroundColor,
        renderHTML: (attributes) => {
          if (!attributes.color && !attributes.userName) {
            return {}
          }
          const style = buildHighlightMarkStyle(attributes)
          const result: Record<string, string> = {}
          if (attributes.color) {
            result['data-color'] = attributes.color
            result['data-color-rgb'] = getColorRgb(attributes.color)
          }
          if (style) {
            result.style = style
          }
          return result
        },
      },
      userId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-user-id'),
        renderHTML: (attributes) => {
          if (!attributes.userId) {
            return {}
          }
          return {
            'data-user-id': attributes.userId,
          }
        },
      },
      userName: {
        default: null,
        // Kept in ProseMirror attrs for widgets; not exposed as data-user-name on mark.
        parseHTML: (element) =>
          parseHighlightUserNameFromElement(element as HTMLElement),
        renderHTML: () => ({}),
      },
      note: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-note'),
        renderHTML: (attributes) => {
          if (!attributes.note) {
            return {}
          }
          return {
            'data-note': attributes.note,
          }
        },
      },
      overlapCount: {
        default: 1,
        parseHTML: (element) =>
          parseInt(element.getAttribute('data-overlap-count') || '1'),
        renderHTML: (attributes) => {
          const count = attributes.overlapCount || 1
          return {
            'data-overlap-count': count.toString(),
          }
        },
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: 'mark[data-highlight-id]',
      },
      {
        tag: 'span[data-highlight-id]',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'mark',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      0,
    ]
  },

  addCommands() {
    return {
      setHighlight:
        (attributes) =>
        ({ commands }) => {
          return commands.setMark(this.name, attributes)
        },
      toggleHighlight:
        (attributes) =>
        ({ commands }) => {
          return commands.toggleMark(this.name, attributes)
        },
      unsetHighlight:
        () =>
        ({ commands }) => {
          return commands.unsetMark(this.name)
        },
    }
  },

  addProseMirrorPlugins() {
    const { onHighlightClick, highlights: configuredHighlights } = this.options
    const tapState: { startX: number; startY: number } = {
      startX: 0,
      startY: 0,
    }

    return [
      new Plugin({
        key: new PluginKey('highlightClick'),
        props: {
          handleClick: (view, pos, event) => {
            if (!onHighlightClick) {
              return false
            }

            const target = event.target as HTMLElement
            if (target.closest('.highlight-attribution-control')) {
              return false
            }

            const { schema, doc } = view.state
            const range = doc.resolve(pos)
            const marks = range.marks()

            let highlightMark = marks.find(
              (mark) => mark.type === schema.marks.highlight
            )

            // Fallback: check adjacent position for boundary clicks
            if (!highlightMark && pos > 0) {
              const prevMarks = doc.resolve(pos - 1).marks()
              highlightMark = prevMarks.find(
                (mark) => mark.type === schema.marks.highlight
              )
            }

            if (highlightMark && highlightMark.attrs.id) {
              event.preventDefault()
              event.stopPropagation()
              onHighlightClick(
                highlightMark.attrs as HighlightAttributes,
                event as MouseEvent
              )
              return true
            }

            return false
          },
          handleDOMEvents: {
            touchstart: (_view, event) => {
              const touchEvent = event as TouchEvent
              const touch = touchEvent.touches[0]
              if (!touch) return false
              tapState.startX = touch.clientX
              tapState.startY = touch.clientY
              return false
            },
            // Handle touch events for mobile devices
            touchend: (view, event) => {
              if (!onHighlightClick) {
                return false
              }

              const target = event.target as HTMLElement
              if (target.closest('.highlight-attribution-control')) {
                return false
              }

              // Get the touch position
              const touch = event.changedTouches[0]
              if (!touch) return false
              const dx = touch.clientX - tapState.startX
              const dy = touch.clientY - tapState.startY
              if (Math.hypot(dx, dy) > 10) {
                return false
              }

              // Find the position in the document
              const pos = view.posAtCoords({
                left: touch.clientX,
                top: touch.clientY,
              })
              if (!pos) return false

              const { schema, doc } = view.state
              const range = doc.resolve(pos.pos)
              const marks = range.marks()

              let highlightMark = marks.find(
                (mark) => mark.type === schema.marks.highlight
              )

              // Fallback: check adjacent position for boundary touches
              if (!highlightMark && pos.pos > 0) {
                const prevMarks = doc.resolve(pos.pos - 1).marks()
                highlightMark = prevMarks.find(
                  (mark) => mark.type === schema.marks.highlight
                )
              }

              if (highlightMark && highlightMark.attrs.id) {
                event.preventDefault()
                event.stopPropagation()
                onHighlightClick(
                  highlightMark.attrs as HighlightAttributes,
                  event as unknown as MouseEvent
                )
                return true
              }

              return false
            },
          },
        },
      }),
      new Plugin({
        key: new PluginKey('highlightDecoration'),
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, set) => {
            // Update decorations if needed
            return set.map(tr.mapping, tr.doc)
          },
        },
        props: {
          decorations(state) {
            const { doc, schema } = state
            const decorations: Decoration[] = []
            const overlapManager = new HighlightOverlapManager()
            const highlightRanges = new Map<
              string,
              { to: number; attrs: HighlightAttributes }
            >()

            // Register all saved highlight ranges (offsets survive mark coalescing)
            for (const configured of configuredHighlights) {
              if (
                configured.startOffset == null ||
                configured.endOffset == null
              ) {
                continue
              }
              const from = HighlightConverter.getDocumentPosition(
                doc,
                configured.startOffset
              )
              const to = HighlightConverter.getDocumentPosition(
                doc,
                configured.endOffset
              )
              if (to > from) {
                overlapManager.addHighlight(configured.id, from, to)
              }
            }

            // First pass: collect mark ranges for attribution controls
            doc.descendants((node, pos) => {
              if (node.isText && node.marks.length) {
                node.marks.forEach((mark) => {
                  if (mark.type === schema.marks.highlight && mark.attrs.id) {
                    const id = mark.attrs.id as string
                    const from = pos
                    const to = pos + node.nodeSize

                    const hasConfiguredOffsets = configuredHighlights.some(
                      (h) => h.startOffset != null && h.endOffset != null
                    )
                    if (!hasConfiguredOffsets) {
                      overlapManager.addHighlight(id, from, to)
                    }

                    const existing = highlightRanges.get(id)
                    if (existing) {
                      existing.to = Math.max(existing.to, to)
                    } else {
                      highlightRanges.set(id, {
                        to,
                        attrs: mark.attrs as HighlightAttributes,
                      })
                    }
                  }
                })
              }
            })

            // Second pass: inline overlap styling per text node
            doc.descendants((node, pos) => {
              if (node.isText && node.marks.length) {
                node.marks.forEach((mark) => {
                  if (mark.type === schema.marks.highlight) {
                    const from = pos
                    const to = pos + node.nodeSize
                    const markOverlap = mark.attrs.overlapCount as
                      | number
                      | undefined
                    const overlapCount = markOverlap
                      ? Math.min(5, Math.max(1, markOverlap))
                      : overlapManager.getOverlapCount(from, to)
                    const colorRgb = getColorRgb(mark.attrs.color || '#F59E0B')

                    decorations.push(
                      Decoration.inline(from, to, {
                        class: 'highlight-animated',
                        'data-overlap-count': overlapCount.toString(),
                        style: `
                          --highlight-color: ${mark.attrs.color || '#F59E0B'};
                          --highlight-color-rgb: ${colorRgb};
                        `,
                      })
                    )
                  }
                })
              }
            })

            // One focusable control per highlight at the end of its range
            highlightRanges.forEach(({ to, attrs }) => {
              if (!attrs.id) return
              decorations.push(
                Decoration.widget(
                  to,
                  () => createHighlightControlButton(attrs, onHighlightClick),
                  {
                    side: 1,
                    key: `highlight-control-${attrs.id}`,
                  }
                )
              )
            })

            return DecorationSet.create(doc, decorations)
          },
        },
      }),
    ]
  },
})

export default HighlightExtension
