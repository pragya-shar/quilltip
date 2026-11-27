// The fixture article, written for the read suite: Tiptap JSON with every
// block the reading view renders. Sentences the spec chooses are exported.

const text = (value: string, marks?: { type: string; attrs?: object }[]) =>
  marks ? { type: 'text', text: value, marks } : { type: 'text', text: value }
const p = (...content: object[]) => ({ type: 'paragraph', content })

export const WRITER = 'tomas'
export const SLUG = 'what-the-ledger-kept'
export const ARTICLE_PATH = `/${WRITER}/${SLUG}`
export const TITLE = 'What my grandmother’s ledger taught me about money'

export const LINES = {
  opening: 'My grandmother kept a ledger for forty-one years.',
  green: 'It was a green cloth book with a cracked spine.',
  pesos: 'Two pesos to the boy who carried her bags.',
  bus: 'A peso for the bus.',
  gate: 'You cannot write a person next to a tap at a gate.',
  quote: 'It rarely remembers anyone.',
  item: 'A date, a name, a coin.',
  late: 'So I have started again, smaller.',
} as const

const filler = [
  'Every evening after the dishes she sat at the kitchen table and wrote down what had gone out and what had come in. The kitchen smelled of soap and of the oranges she kept in a bowl by the window.',
  'She never added the columns. When I asked her why, she said the totals were not the point, and went back to writing in her small upright hand.',
  'Five to Señora Ruiz, for the medicine. One to a singer on the 14 bus. Ten to the school, for the roof that leaked onto the third row of desks.',
  'When she died we read it aloud, one line each, around the table. Nobody cried until the singer on the 14 bus, and then everybody did.',
]

export const CONTENT = {
  type: 'doc',
  content: [
    p(
      text(
        `${LINES.opening} ${LINES.green} Every evening she wrote what had gone out and what had come in.`
      )
    ),
    p(
      text(
        `${LINES.pesos} ${LINES.bus} For thirty years she wrote one line each time she gave something away: `
      ),
      text('a date, a name, a coin', [{ type: 'italic' }]),
      text('.')
    ),
    { type: 'heading', attrs: { level: 2 }, content: [text('The line')] },
    p(
      text(
        'I have tried to keep a ledger like hers. I lasted nine days. My money moves faster than hers did, and most of it leaves without a name attached. '
      ),
      text(LINES.gate)
    ),
    {
      type: 'blockquote',
      content: [p(text(`Money moves faster than it used to. ${LINES.quote}`))],
    },
    {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [p(text(LINES.item))] },
        {
          type: 'listItem',
          content: [p(text('A coin for the bus, and a name for the driver.'))],
        },
      ],
    },
    {
      type: 'resizableImage',
      attrs: {
        src: '/img/ledger.svg',
        alt: 'An open ledger on a kitchen table',
        title: 'The ledger, open at 1987.',
        width: 800,
        height: 533,
      },
    },
    p(
      text(
        'She wrote in pencil, so that a name could be corrected but never removed. '
      ),
      text('Read about the ledger tradition', [
        { type: 'link', attrs: { href: 'https://example.org/ledgers' } },
      ]),
      text(' if you want to keep one.')
    ),
    {
      type: 'codeBlock',
      attrs: { language: null },
      content: [
        text('1987-03-04  Señora Ruiz   5\n1987-03-04  Bus singer   1'),
      ],
    },
    ...filler.flatMap((f) => [p(text(f))]),
    ...filler.map((f) => p(text(f.replace('She', 'My grandmother')))),
    p(
      text(
        `${LINES.late} One line a day, on purpose. Most days it is a coffee.`
      )
    ),
  ],
}

export const ARTICLE = {
  _id: 'readfixturearticle00000000000001',
  slug: SLUG,
  title: TITLE,
  content: CONTENT,
  coverImage: null,
  publishedAt: Date.UTC(2026, 10, 26),
  readTime: 6,
  updatedAt: Date.UTC(2026, 10, 26),
  contentVersion: 1,
  author: { name: 'Tomás Reyes', username: WRITER, avatar: null },
}
