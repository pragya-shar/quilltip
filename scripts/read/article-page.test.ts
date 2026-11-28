import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// The article route when its server read fails or times out: the
// unreachable state, never a 404, and never indexed. (Dynamic routes send
// Cache-Control: no-store; the production-build checks see the header.)

const tipState = vi.hoisted(() => ({
  articleTippable: vi.fn<() => Promise<boolean | null>>(async () => null),
}))
vi.mock('@/components/read/tipState', () => tipState)

const reads = vi.hoisted(() => ({
  article: vi.fn<() => Promise<unknown>>(),
  moved: vi.fn<() => Promise<string | null>>(),
}))
vi.mock('@/lib/seo/publicContent', () => ({
  getPublishedArticle: reads.article,
  movedPublicPath: reads.moved,
}))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`)
  },
  useRouter: () => ({ back: () => {} }),
  usePathname: () => '/tomas/ledger',
}))
vi.mock('@/components/read/read.css', () => ({}))
vi.mock('@/components/read/balanceCaption.css', () => ({}))
// The islands render on the server with no backend: no answers yet.
vi.mock('convex/react', () => ({
  useQuery: () => undefined,
  useMutation: () => async () => null,
  useConvexAuth: () => ({ isLoading: true, isAuthenticated: false }),
}))
vi.mock('next/link', async () => {
  const { createElement } = await import('react')
  return {
    default: ({ href, children }: { href: string; children: unknown }) =>
      createElement('a', { href }, children as never),
  }
})

const { default: ArticlePage, generateMetadata } =
  await import('../../app/(app)/(public)/[username]/[slug]/page')
const args = {
  params: Promise.resolve({ username: 'tomas', slug: 'ledger' }),
  searchParams: Promise.resolve({ ref: 'share' }),
}

describe('the article route with no answer from the backend', () => {
  it('shows the unreachable state with Try again to the same URL', async () => {
    reads.article.mockResolvedValue(undefined)
    const html = renderToStaticMarkup(await ArticlePage(args))
    expect(html).toContain('This article could not be loaded right now.')
    expect(html).toContain('href="/tomas/ledger?ref=share"')
    expect(html).toContain('<meta name="robots" content="noindex"/>')
  })

  it('asks not to be indexed', async () => {
    reads.article.mockResolvedValue(undefined)
    const metadata = await generateMetadata(args)
    expect(metadata.robots).toEqual({ index: false })
  })

  it('an oversized document shows the not-available state', async () => {
    let node: object = {
      type: 'paragraph',
      content: [{ type: 'text', text: 'x' }],
    }
    for (let i = 0; i < 5_000; i++)
      node = { type: 'blockquote', content: [node] }
    reads.article.mockResolvedValue({
      _id: 'a1',
      slug: 'ledger',
      title: 'Ledger',
      content: { type: 'doc', content: [node] },
      author: { name: 'Tomás Reyes', username: 'tomas' },
    })
    const html = renderToStaticMarkup(await ArticlePage(args))
    expect(html).toContain('This article could not be loaded right now.')
    expect(html).not.toContain('id="read-body"')
    const metadata = await generateMetadata(args)
    expect(metadata.title).toBe('Ledger')
    expect(metadata.description ?? '').toBe('')
  })

  it('a missing article is a 404, and a moved handle redirects', async () => {
    reads.article.mockResolvedValue(null)
    reads.moved.mockResolvedValue(null)
    await expect(ArticlePage(args)).rejects.toThrow('NEXT_NOT_FOUND')
    expect((await generateMetadata(args)).robots).toEqual({ index: false })
    reads.moved.mockResolvedValue('/tomas-r/ledger')
    await expect(ArticlePage(args)).rejects.toThrow(
      'NEXT_REDIRECT /tomas-r/ledger'
    )
  })
})

describe('the article route and ?live=1', () => {
  it('sends the same HTML and metadata with and without the parameter', async () => {
    reads.article.mockResolvedValue({
      _id: 'a1',
      slug: 'ledger',
      title: 'Ledger',
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'One. Two.' }] },
        ],
      },
      author: { name: 'Tomás Reyes', username: 'tomas' },
    })
    const at = (query: Record<string, string>) => ({
      params: Promise.resolve({ username: 'tomas', slug: 'ledger' }),
      searchParams: Promise.resolve(query),
    })
    const plain = renderToStaticMarkup(await ArticlePage(at({})))
    const live = renderToStaticMarkup(await ArticlePage(at({ live: '1' })))
    expect(plain).toContain('id="read-body"')
    expect(live).toBe(plain)
    expect(await generateMetadata(at({ live: '1' }))).toEqual(
      await generateMetadata(at({}))
    )
  })
})

describe('the article route and an article that cannot take a tip', () => {
  const article = {
    _id: 'k57rdfxtrartc1e0000000000000000001',
    slug: 'ledger',
    title: 'Ledger',
    content: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'One. Two.' }] },
      ],
    },
    author: { name: 'Tomás Reyes', username: 'tomas' },
  }

  it('sends no tip control in the HTML, signed out and with no script', async () => {
    reads.article.mockResolvedValue(article)
    tipState.articleTippable.mockResolvedValue(false)
    const html = renderToStaticMarkup(await ArticlePage(args))
    expect(html).toContain('Tips are not on for this article.')
    expect(html).not.toMatch(/qt-tip\b|qt-read__signin|>Tip /)
    expect(tipState.articleTippable).toHaveBeenCalledWith(
      article._id,
      expect.any(Number)
    )
  })

  it('leaves a registered article unchanged', async () => {
    reads.article.mockResolvedValue(article)
    tipState.articleTippable.mockResolvedValue(true)
    const html = renderToStaticMarkup(await ArticlePage(args))
    expect(html).not.toContain('Tips are not on for this article.')
    expect(html).toContain('qt-read__control')
  })

  it("draws the tip bar's first paint from the server, with no session known", async () => {
    reads.article.mockResolvedValue(article)
    tipState.articleTippable.mockResolvedValue(true)
    const { createElement } = await import('react')
    const { BalanceSourceContext } = await import('@/shell/balance')
    const page = await ArticlePage(args)
    const html = renderToStaticMarkup(
      createElement(
        BalanceSourceContext.Provider,
        {
          value: () => ({
            auth: 'loading' as const,
            available: null,
            status: 'loading' as const,
          }),
        },
        page
      )
    )
    // The shell's pre-paint marker shows one: the plain sign-in link (and
    // with no script, always the link), or the tip control.
    const bar = html.slice(html.indexOf('data-session-switch'))
    expect(bar).toMatch(
      /data-when="signed-out"[^>]*><a class="qt-read__signin" href="\/login\?returnTo=/
    )
    expect(bar).toContain('data-when="held"')
    expect(bar).toMatch(/qt-tip\b/)
    // The server's label: the writer's first name and the default amount.
    expect(bar).toMatch(/Tip [^<]+<\/span> <span class="qt-tip__amount">\$1</)
  })
})

describe('the article route and hostile addresses', () => {
  it('encodes the Try again link: /%5Chost/x never links off-site', async () => {
    reads.article.mockResolvedValue(undefined)
    // Route params arrive decoded: `%5C` is a backslash here.
    const html = renderToStaticMarkup(
      await ArticlePage({
        params: Promise.resolve({ username: '\\host', slug: 'x' }),
        searchParams: Promise.resolve({}),
      })
    )
    expect(html).toContain('href="/%5Chost/x"')
    expect(html).not.toMatch(/href="\/\\/)
    expect(html).not.toMatch(/href="\/\//)
  })

  it("draws a writer's avatar only under the image rule, and sends no referrer", async () => {
    tipState.articleTippable.mockResolvedValue(null)
    reads.article.mockResolvedValue({
      _id: 'k57rdfxtrartc1e0000000000000000001',
      slug: 'ledger',
      title: 'Ledger',
      content: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'One.' }] },
        ],
      },
      author: {
        name: 'Tomás Reyes',
        username: 'tomas',
        avatar: 'https://logger.example/pixel.png?reader=1',
      },
    })
    const html = renderToStaticMarkup(await ArticlePage(args))
    expect(html).not.toContain('logger.example')
    // Initials instead.
    expect(html).toContain('>TR<')
    expect((await generateMetadata(args)).referrer).toBe('no-referrer')
  })
})
