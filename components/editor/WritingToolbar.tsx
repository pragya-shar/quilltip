'use client'
import type { MouseEvent } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
function keepEditorSelection(event: MouseEvent<HTMLButtonElement>) {
  event.preventDefault()
}

export function WritingToolbar({
  editor,
  onLink,
  onClose,
}: {
  editor: Editor
  onLink: () => void
  onClose: () => void
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor.isActive('bold'),
      italic: editor.isActive('italic'),
      heading: editor.getAttributes('heading').level || 'p',
      quote: editor.isActive('blockquote'),
      list: editor.isActive('bulletList'),
    }),
  })
  return (
    <div
      id="writing-format-tools"
      className="formatbar"
      role="group"
      aria-label="Text formatting"
    >
      <button
        aria-label="Bold"
        onMouseDown={keepEditorSelection}
        aria-pressed={state.bold}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <b>B</b>
      </button>
      <button
        aria-label="Italic"
        onMouseDown={keepEditorSelection}
        aria-pressed={state.italic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <i>I</i>
      </button>
      <button
        aria-label="Section heading"
        onMouseDown={keepEditorSelection}
        aria-pressed={state.heading === 2}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        H2
      </button>
      <button
        aria-label="Quote"
        onMouseDown={keepEditorSelection}
        aria-pressed={state.quote}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        ❝
      </button>
      <button
        aria-label="Bulleted list"
        onMouseDown={keepEditorSelection}
        aria-pressed={state.list}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        • ≡
      </button>
      <button onClick={onLink}>Link</button>
      <button
        aria-label="Paragraph"
        onMouseDown={keepEditorSelection}
        onClick={() => editor.chain().focus().setParagraph().run()}
      >
        ¶
      </button>
      <button aria-label="Close formatting" onClick={onClose}>
        ×
      </button>
    </div>
  )
}
