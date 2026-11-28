import type { JSONContent } from '@tiptap/react'

export const PASSAGE_PARAGRAPH =
  'Margins are where a reader answers the page. Some readers underline, some argue, and some leave a small mark that means this line was worth the stop.'

export const CONTENT: JSONContent = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: PASSAGE_PARAGRAPH }] },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'A tip is a margin note with weight. It says the same thing as an underline, and it reaches the writer.',
        },
      ],
    },
  ],
}

/** The article row the reader's queries return. */
export const ARTICLE = {
  _id: 'k17passagetouchfixture',
  slug: 'a-short-note-on-margins',
  title: 'A short note on margins',
  authorName: 'Ada Lovelace',
  author: { name: 'Ada Lovelace', stellarAddress: undefined },
  content: CONTENT,
}
