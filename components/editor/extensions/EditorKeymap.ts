import { Extension } from '@tiptap/core'

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export const EditorKeymap = Extension.create({
  name: 'editorKeymap',
  priority: 10_000,

  addKeyboardShortcuts() {
    const focus = () => this.editor.chain().focus()

    return {
      'Mod-z': () => focus().undo().run(),
      'Shift-Mod-z': () => focus().redo().run(),
      // Common redo shortcut on Windows/Linux.
      'Mod-y': () => focus().redo().run(),

      'Mod-b': () => focus().toggleBold().run(),
      'Mod-i': () => focus().toggleItalic().run(),

      'Mod-Shift-i': () => focus().selectResizableImage().run(),

      'Mod-k': () => {
        if (typeof window === 'undefined') return false

        const previousUrl = this.editor.getAttributes('link')?.href
        const url = window.prompt(
          'Enter URL',
          isNonEmptyString(previousUrl) ? previousUrl : ''
        )

        if (url == null) return false

        const trimmed = url.trim()
        if (!trimmed) {
          return focus().extendMarkRange('link').unsetLink().run()
        }

        return focus().extendMarkRange('link').setLink({ href: trimmed }).run()
      },
    }
  },
})
