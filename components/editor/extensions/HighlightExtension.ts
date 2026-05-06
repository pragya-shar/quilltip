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
          if (!attributes.color) {
            return {}
          }
          return {
            'data-color': attributes.color,
            'data-color-rgb': getColorRgb(attributes.color),
            style: `--highlight-color: ${attributes.color}; --highlight-color-rgb: ${getColorRgb(attributes.color)}; --highlight-opacity: 0.4;`,
          }
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
        parseHTML: (element) => element.getAttribute('data-user-name'),
        renderHTML: (attributes) => {
          if (!attributes.userName) {
            return {}
          }
          return {
            'data-user-name': attributes.userName,
          }
        },
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
            title: attributes.note, // Show note on hover
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

            // First pass: collect all highlights
            doc.descendants((node, pos) => {
              if (node.isText && node.marks.length) {
                node.marks.forEach((mark) => {
                  if (mark.type === schema.marks.highlight && mark.attrs.id) {
                    overlapManager.addHighlight(
                      mark.attrs.id,
                      pos,
                      pos + node.nodeSize
                    )
                  }
                })
              }
            })

            // Second pass: create decorations with overlap counts
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

            return DecorationSet.create(doc, decorations)
          },
        },
      }),
    ]
  },
})

export default HighlightExtension
