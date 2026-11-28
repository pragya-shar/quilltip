// Synthetic public data for the page-load budget check. It mirrors the shape
// of the public queries the measured pages read, so CI can render real pages
// without a backend or secrets. All text here is written for the fixture.

export const FIXTURE_WRITER = 'fixture-writer'
export const FIXTURE_SLUG = 'the-lamp-on-orchard-street'
export const FIXTURE_ARTICLE_PATH = `/${FIXTURE_WRITER}/${FIXTURE_SLUG}`
/** The writer's other published articles, 2 to 9. */
export const fixtureArticlePath = (n: number) =>
  `/${FIXTURE_WRITER}/fixture-article-${n}`
/** An unpublished article by the fixture writer: no public page shows it. */
export const FIXTURE_DRAFT = {
  slug: 'the-unsent-letter',
  title: 'The Unsent Letter',
  text: 'This draft sentence must never reach a public page.',
}

const PARAGRAPHS = [
  'The lamp on Orchard Street came on every evening at a quarter past six, a little before the others, as if it had somewhere to be.',
  'Noor had walked past it for eleven years without once looking up. She knew the cracked kerb under it, the bakery bins beside it and the dent in the post where a delivery van had misjudged the corner one wet November, but the lamp itself had never been part of the picture she kept of the street.',
  'That changed on the evening it did not come on. The bakery had closed early, the bins were already out, and the corner sat in a grey half-light that made the whole street look unfinished, like a sketch somebody meant to come back to.',
  'She stood there longer than she meant to. A man with a dog stopped as well, then a teenager with a skateboard under one arm, and for a moment the three of them looked up at the dark glass together, the way people look at a clock that has stopped.',
  '“It’s always first,” the man said, to nobody in particular.',
  '“I thought I imagined that,” said Noor.',
  'The teenager shrugged. “My nan times her tea by it.”',
  'They laughed, and then they did not quite know how to leave. Strangers who have shared a small surprise owe each other something, even if it is only a nod, and none of them had worked out the size of the debt.',
  'The next morning Noor wrote to the council. She was not sure what she expected: a reference number, perhaps, or a form that asked her to describe the lamp in a box too small for the description.',
  'What came back was a short reply from someone called Ade, who looked after the street lights on that side of the river. He thanked her, said the lamp was one of the old ones with a slightly faster timer, and promised a visit within the week.',
  'He came on the Thursday. Noor saw the van from her window and went down, telling herself it was to check the work, though really she wanted to see the inside of a thing she had suddenly started to care about.',
  'Ade let her look. The timer was a small grey box with a dial that had drifted over the years. “Most of them run late,” he said. “This one decided to run early. I could set it right.”',
  'Noor thought about the teenager’s nan and her tea, and about the man with the dog, and about all the evenings the lamp had quietly told the street it was time to go home.',
  '“Could you set it wrong?” she asked. “The same wrong as before.”',
  'Ade looked at her for a long second, then at the dial, then back at her. He did not say anything about regulations. He turned the dial a fraction past where it should have been and closed the box.',
  'That evening the lamp came on at a quarter past six. Noor was not at the window to see it. She was downstairs, on the corner, with the man and the dog, and the teenager, and an older woman with a thermos who said she had heard there might be a small gathering.',
  'Nobody made a speech. Someone had brought biscuits from the bakery. The lamp hummed above them, and when the others came on a few minutes later, down the length of the street, it looked for all the world as if they were catching up.',
  'Noor still walks past it most days. She looks up now. Sometimes she thinks about writing to Ade again, just to say thank you properly, but she suspects he already knows.',
]

const FIXTURE_AUTHOR = {
  id: 'fixtureauthor0000000000000000000',
  name: 'Fixture Writer',
  username: FIXTURE_WRITER,
}

const BASE_TIME = 1_790_000_000_000

function articleContent(paragraphs: string[]) {
  return {
    type: 'doc',
    attrs: { quilltipAppearance: null },
    content: paragraphs.map((text) => ({
      type: 'paragraph',
      attrs: { textAlign: null },
      content: [{ type: 'text', text }],
    })),
  }
}

function fixtureArticle(index: number, draft = false) {
  const title = draft
    ? FIXTURE_DRAFT.title
    : index === 0
      ? 'The Lamp on Orchard Street'
      : `Fixture Article ${index + 1}: Notes from a Quiet Street`
  const slug = draft
    ? FIXTURE_DRAFT.slug
    : index === 0
      ? FIXTURE_SLUG
      : `fixture-article-${index + 1}`
  const paragraphs = draft
    ? [FIXTURE_DRAFT.text]
    : index === 0
      ? PARAGRAPHS
      : PARAGRAPHS.slice(0, 6)
  return {
    _creationTime: BASE_TIME - index * 86_400_000,
    _id: `fixturearticle${String(index).padStart(18, '0')}`,
    arweaveStatus: undefined,
    author: FIXTURE_AUTHOR,
    authorId: FIXTURE_AUTHOR.id,
    authorName: FIXTURE_AUTHOR.name,
    authorUsername: FIXTURE_WRITER,
    content: articleContent(paragraphs),
    contentVersion: 1,
    // No cover: list cards use the local public-domain artwork, so the check
    // needs no image host.
    coverImage: undefined,
    createdAt: BASE_TIME - index * 86_400_000,
    excerpt:
      'A street lamp that always came on a little early, and the neighbours who noticed when it stopped.',
    highlightCount: 0,
    published: !draft,
    publishedAt: draft ? undefined : BASE_TIME - index * 86_400_000,
    readTime: index === 0 ? 4 : 1,
    // Real rows carry the search text too; /articles must not send it.
    searchContent: `${title} ${paragraphs.join(' ')}`,
    slug,
    tags: ['stories'],
    tipCount: 0,
    tipStats: { totalTips: 0, totalAmountUsd: 0, uniqueTippers: 0 },
    title,
    totalTipsUsd: 0,
    updatedAt: BASE_TIME - index * 86_400_000,
    viewCount: 0,
  }
}

/**
 * Every row the fixture writer has, as the database holds them. The public
 * queries below return published rows only, as the real Convex queries do.
 */
const ROWS = [
  ...Array.from({ length: 9 }, (_, index) => fixtureArticle(index)),
  fixtureArticle(9, true),
]
const ARTICLES = ROWS.filter((row) => row.published)

function publishedBySlug(username: unknown, slug: unknown) {
  if (username !== FIXTURE_WRITER) return null
  return ARTICLES.find((row) => row.slug === slug) ?? null
}

type QueryArgs = Record<string, unknown>

/** Answers a public query by function path, or returns undefined if unknown. */
export function answerFixtureQuery(
  path: string,
  args: QueryArgs
): { value: unknown } | undefined {
  switch (path) {
    case 'publicRoutes:resolvePublicRoute': {
      const found =
        args.username === FIXTURE_WRITER &&
        (args.slug === undefined ||
          publishedBySlug(args.username, args.slug) !== null)
      return { value: { kind: found ? 'found' : 'missing' } }
    }
    case 'articles:getArticleBySlug':
      return {
        value: publishedBySlug(args.username, args.slug),
      }
    // The writer page (/fixture-writer): public fields only, as the real
    // query returns them.
    case 'users:getUserByUsername':
      return {
        value:
          args.username === FIXTURE_WRITER
            ? {
                _id: FIXTURE_AUTHOR.id,
                _creationTime: BASE_TIME,
                name: FIXTURE_AUTHOR.name,
                username: FIXTURE_WRITER,
                bio: 'Writes short stories about streets and the people on them.',
                avatar: undefined,
                stellarAddress: undefined,
                articleCount: ARTICLES.length,
                highlightCount: 0,
                nftsCreated: 0,
                nftsOwned: 0,
                createdAt: BASE_TIME,
              }
            : null,
      }
    case 'articles:listArticles':
      return {
        value: {
          articles: ARTICLES,
          browseMeta: {},
          limit: 9,
          page: 1,
          total: ARTICLES.length,
          totalPages: 1,
        },
      }
    default:
      return undefined
  }
}
