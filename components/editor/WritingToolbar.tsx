'use client'
import { useEditorState, type Editor } from '@tiptap/react'
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
      underline: editor.isActive('underline'),
      strike: editor.isActive('strike'),
      heading: editor.getAttributes('heading').level || 'p',
      quote: editor.isActive('blockquote'),
      list: editor.isActive('bulletList'),
    }),
  })
  return (
    <div
      className="formatbar"
      role="toolbar"
      aria-label="Text formatting"
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest('button')) e.preventDefault()
      }}
    >
      <button
        aria-label="Bold"
        aria-pressed={state.bold}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <b>B</b>
      </button>
      <button
        aria-label="Italic"
        aria-pressed={state.italic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <i>I</i>
      </button>
      <button
        aria-label="Section heading"
        aria-pressed={state.heading === 2}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        H2
      </button>
      <button
        aria-label="Quote"
        aria-pressed={state.quote}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        ❝
      </button>
      <button
        aria-label="Bulleted list"
        aria-pressed={state.list}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        • ≡
      </button>
      <button onClick={onLink}>Link</button>
      <button
        aria-label="Paragraph"
        onClick={() => editor.chain().focus().setParagraph().run()}
      >
        ¶
      </button>
      <select
        aria-label="More formatting"
        value=""
        onChange={(e) => {
          const v = e.target.value
          const c = editor.chain().focus()
          if (v === 'underline') c.toggleUnderline().run()
          if (v === 'strike') c.toggleStrike().run()
          if (v === 'ordered') c.toggleOrderedList().run()
          if (v === 'code') c.toggleCodeBlock().run()
          if (v === 'undo') c.undo().run()
          if (v === 'redo') c.redo().run()
          if (v.startsWith('h'))
            c.toggleHeading({
              level: Number(v.slice(1)) as 1 | 2 | 3 | 4 | 5 | 6,
            }).run()
          if (['left', 'center', 'right', 'justify'].includes(v))
            c.setTextAlign(v).run()
        }}
      >
        <option value="">More</option>
        <option value="underline">Underline</option>
        <option value="strike">Strikethrough</option>
        <option value="ordered">Numbered list</option>
        <option value="code">Code block</option>
        {[1, 3, 4, 5, 6].map((n) => (
          <option key={n} value={`h${n}`}>
            Heading {n}
          </option>
        ))}
        {['left', 'center', 'right', 'justify'].map((v) => (
          <option key={v} value={v}>
            {v} align
          </option>
        ))}
        <option value="undo">Undo</option>
        <option value="redo">Redo</option>
      </select>
      <button aria-label="Close formatting" onClick={onClose}>
        ×
      </button>
    </div>
  )
}
