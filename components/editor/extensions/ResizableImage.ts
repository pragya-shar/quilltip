import { Node, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import ResizableImageComponent from './ResizableImageComponent'

export interface ImageOptions {
  inline: boolean
  allowBase64: boolean
  HTMLAttributes: Record<string, unknown>
}

export function parseNumericAttr(
  value: string | number | null | undefined
): number | null {
  if (value == null || value === '') return null
  const n = typeof value === 'number' ? value : Number.parseInt(String(value), 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

function findResizableImagePos(editor: Editor): number | null {
  const { state } = editor
  const { selection, doc } = state

  if (
    selection instanceof NodeSelection &&
    selection.node.type.name === 'resizableImage'
  ) {
    return selection.from
  }

  let closestPos: number | null = null
  let closestDist = Infinity

  doc.descendants((node, pos) => {
    if (node.type.name !== 'resizableImage') return
    const dist = Math.min(
      Math.abs(pos - selection.from),
      Math.abs(pos + node.nodeSize - selection.to)
    )
    if (dist < closestDist) {
      closestDist = dist
      closestPos = pos
    }
  })

  return closestPos
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    resizableImage: {
      setResizableImage: (options: {
        src: string
        alt?: string
        title?: string
        width?: number
        height?: number
      }) => ReturnType
      selectResizableImage: () => ReturnType
    }
  }
  interface Storage {
    resizableImage: {
      shouldFocus: boolean
    }
  }
}

export const ResizableImage = Node.create<ImageOptions>({
  name: 'resizableImage',

  addStorage() {
    return {
      shouldFocus: false,
    }
  },

  addOptions() {
    return {
      inline: false,
      allowBase64: false,
      HTMLAttributes: {},
    }
  },

  inline() {
    return this.options.inline
  },

  group() {
    return this.options.inline ? 'inline' : 'block'
  },

  draggable: true,

  addAttributes() {
    return {
      src: {
        default: null,
      },
      alt: {
        default: null,
      },
      title: {
        default: null,
      },
      width: {
        default: null,
        parseHTML: (element) =>
          parseNumericAttr(element.getAttribute('width')),
        renderHTML: (attributes) => {
          const width = parseNumericAttr(attributes.width)
          if (width == null) return {}
          return { width: String(width) }
        },
      },
      height: {
        default: null,
        parseHTML: (element) =>
          parseNumericAttr(element.getAttribute('height')),
        renderHTML: (attributes) => {
          const height = parseNumericAttr(attributes.height)
          if (height == null) return {}
          return { height: String(height) }
        },
      },
    }
  },

  parseHTML() {
    return [
      {
        tag: this.options.allowBase64
          ? 'img[src]'
          : 'img[src]:not([src^="data:"])',
      },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)]
  },

  addCommands() {
    return {
      setResizableImage:
        (options) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: options,
          })
        },
      selectResizableImage:
        () =>
        ({ editor, chain }) => {
          const pos = findResizableImagePos(editor)
          if (pos == null) return false
          editor.storage.resizableImage.shouldFocus = true
          return chain().setNodeSelection(pos).run()
        },
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageComponent)
  },
})
