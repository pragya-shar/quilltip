import { Mark, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export interface HighlightAttributes {
  id: string
  color: string
  userId: string
  userName?: string
  userAvatar?: string
  note?: string
  createdAt: number
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

/** Build inline style for highlight marks (visual only, not screen-reader metadata). */
export function buildHighlightMarkStyle(attributes: {
  color?: string | null
  userName?: string | null
}): string | undefined {
  const parts: string[] = []
  if (attributes.color) {
    parts.push(`--highlight-color: ${attributes.color}`)
    parts.push(`--highlight-color-rgb: ${getColorRgb(attributes.color)}`)
    parts.push('--highlight-opacity: 0.4')
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

// Helper function to convert hex color to RGB values
const getColorRgb = (hexColor: string): string => {
  const colorMap: Record<string, string> = {
    '#F59E0B': '245, 158, 11', // Amber
    '#10B981': '16, 185, 129', // Emerald
    '#3B82F6': '59, 130, 246', // Azure
    '#F43F5E': '244, 63, 94', // Rose
    '#8B5CF6': '139, 92, 246', // Violet
    '#FB7185': '251, 113, 133', // Coral
    // Fallback for old colors
    '#FFEB3B': '255, 235, 59', // Yellow
    '#B2FF59': '178, 255, 89', // Green
    '#40C4FF': '64, 196, 255', // Blue
    '#FF4081': '255, 64, 129', // Pink
    '#E040FB': '224, 64, 251', // Purple
    '#FFAB40': '255, 171, 64', // Orange
  }

  return colorMap[hexColor] || '255, 235, 59' // Default to yellow if not found
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
    const { onHighlightClick } = this.options
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

            // First pass: collect all highlights and merge ranges per id
            doc.descendants((node, pos) => {
              if (node.isText && node.marks.length) {
                node.marks.forEach((mark) => {
                  if (mark.type === schema.marks.highlight && mark.attrs.id) {
                    const id = mark.attrs.id as string
                    const from = pos
                    const to = pos + node.nodeSize
                    overlapManager.addHighlight(id, from, to)

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
                    const overlapCount = overlapManager.getOverlapCount(
                      from,
                      to
                    )
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
