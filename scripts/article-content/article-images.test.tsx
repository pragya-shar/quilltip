// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { JSONContent } from '@tiptap/core'
import { generateHTML } from '@tiptap/html'
import StarterKit from '@tiptap/starter-kit'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArticleReadOnlyBody } from '../../components/articles/ArticleReadOnlyBody'
import { ResizableImage } from '../../components/editor/extensions/ResizableImage'
import ResizableImageComponent from '../../components/editor/extensions/ResizableImageComponent'
import { WritingImageView } from '../../components/editor/WritingImage'
import { isAllowedImageSource } from '../../lib/security/imageSources'
import { imageSourceRefusal } from '../../lib/security/imageSourceRefusal'
import { renderArticleHtml } from '../../lib/tiptap/renderArticleHtml'

// The writing view's upload client; nothing is uploaded here.
vi.mock('convex/react', () => ({ useConvex: () => ({}) }))

const OWN = 'https://own-deployment-123.convex.cloud'
const own = `${OWN}/api/storage/5c1e2f0a-uploaded`
const unsplash = 'https://images.unsplash.com/photo-1?w=800'
const arweave =
  'https://arweave.net/bNbA3TEQVL60xlgCcqdz4ZPHFZ711cZ3hmkpGttDt_U'
const otherConvex = 'https://someone-else-456.convex.cloud/api/storage/x'
const otherSite = 'https://someone-else-456.convex.site/pixel.png'

beforeEach(() => vi.stubEnv('NEXT_PUBLIC_CONVEX_URL', OWN))
afterEach(() => vi.unstubAllEnvs())

describe('image sources (#615)', () => {
  it.each([
    [own, true],
    [`${OWN}/api/storage/a?w=200`, true],
    [unsplash, true],
    ['https://plus.unsplash.com/premium_photo-1', true],
    [arweave, true],
    ['https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg', true],
    ['https://img.youtube.com/other.jpg', false],
    // The own origin admits its storage path only.
    [`${OWN}/api/query`, false],
    [`${OWN}/http/pixel`, false],
    [`${OWN}/`, false],
    [`${OWN}/api/storagex/a`, false],
    // Paths that only look like the storage path.
    [`${OWN}/api/storage/../x`, false],
    [`${OWN}/api/storage/%2e%2e/x`, false],
    [`${OWN}/api/storage%2F..%2Fx`, false],
    [`${OWN}/api%2Fstorage/x`, false],
    [`${OWN}/x?/api/storage/y`, false],
    [`${OWN}/x#/api/storage/y`, false],
    // Hosts that only end with an allowed one.
    ['https://evilarweave.net/x', false],
    ['https://a.images.unsplash.com/x', false],
    ['https://x-own-deployment-123.convex.cloud/api/storage/x', false],
    [
      'https://own-deployment-123.convex.cloud.evil.example/api/storage/x',
      false,
    ],
    [otherConvex, false],
    [otherSite, false],
    ['https://own-deployment-123.convex.site/api/storage/x', false],
    ['http://own-deployment-123.convex.cloud/api/storage/x', false],
    ['https://own-deployment-123.convex.cloud:8443/api/storage/x', false],
    ['https://user@own-deployment-123.convex.cloud/api/storage/x', false],
    ['http://images.unsplash.com/photo-1', false],
    ['https://images.unsplash.com.example/photo-1', false],
    ['https://tracker.example/pixel.png', false],
    ['/api/storage/relative', false],
    ['data:image/png;base64,AAAA', false],
    ['blob:https://quilltip.test/1', false],
    [42, false],
    [null, false],
  ])('%j is allowed: %j', (src, allowed) => {
    expect(isAllowedImageSource(src, OWN)).toBe(allowed)
  })

  it('without a configured deployment, only the listed hosts are allowed', () => {
    expect(isAllowedImageSource(own, undefined)).toBe(false)
    expect(isAllowedImageSource(own, 'not a url')).toBe(false)
    expect(isAllowedImageSource(unsplash, undefined)).toBe(true)
  })

  it('a local or self-hosted backend is its own origin, port included', () => {
    const local = 'http://127.0.0.1:3210'
    expect(isAllowedImageSource(`${local}/api/storage/x`, local)).toBe(true)
    expect(
      isAllowedImageSource('http://127.0.0.1:3211/api/storage/x', local)
    ).toBe(false)
    expect(
      isAllowedImageSource(
        'http://127.0.0.1:3330/api/storage/x',
        'http://127.0.0.1:3330/'
      )
    ).toBe(true)
  })

  it('an image without an address gets its own message', () => {
    for (const src of [undefined, null, '', '  ']) {
      expect(imageSourceRefusal(src)).toBe(
        'An image in this article has no address. Remove it, or upload the image. Images must be uploaded, or come from img.youtube.com, images.unsplash.com, plus.unsplash.com or arweave.net.'
      )
    }
  })

  const allowed =
    'Images must be uploaded, or come from img.youtube.com, images.unsplash.com, plus.unsplash.com or arweave.net.'

  it('the refusal names the host only, and the hosts that are allowed', () => {
    expect(imageSourceRefusal(otherConvex)).toBe(
      `An image from someone-else-456.convex.cloud cannot be used. ${allowed}`
    )
    // A long path, a query, a port and credentials do not reach the message.
    expect(
      imageSourceRefusal(
        `https://user:pass@x.example:8443/${'a'.repeat(300)}?q=${'b'.repeat(50)}#c`
      )
    ).toBe(`An image from x.example cannot be used. ${allowed}`)
    expect(imageSourceRefusal('  http://x.example/a.png  ')).toBe(
      `An image from x.example cannot be used. ${allowed}`
    )
  })

  it('an address with no host to name gets a fixed phrase', () => {
    for (const src of [
      '/relative/picture.png',
      'not an address',
      'data:image/png;base64,iVBORw0KGgo=',
      'blob:https://x.example/0b1c',
      'javascript:alert(1)',
      'ftp://x.example/a.png',
      `https://${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.example/a.png`,
      // A listed host refused for its scheme or path.
      'http://images.unsplash.com/photo-1',
      'https://img.youtube.com/elsewhere/a.jpg',
    ]) {
      expect(imageSourceRefusal(src), src).toBe(
        `That image address cannot be used. ${allowed}`
      )
    }
  })
})

const image = (src: string): JSONContent => ({
  type: 'resizableImage',
  attrs: { src, alt: `Image at ${src}` },
})
const article: JSONContent = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Before.' }] },
    image(own),
    image(otherConvex),
    image(unsplash),
    image(otherSite),
    image(arweave),
    { type: 'paragraph', content: [{ type: 'text', text: 'After.' }] },
  ],
}

function inspect(html: string) {
  const root = document.createElement('div')
  root.innerHTML = html
  return {
    images: [...root.querySelectorAll('img')].map((img) =>
      img.getAttribute('src')
    ),
    hidden: [...root.querySelectorAll('[data-article-image-hidden]')].map(
      (node) => ({ hidden: node.hasAttribute('hidden'), html: node.innerHTML })
    ),
    text: root.textContent,
    html,
  }
}

describe('article images in the readers (#615)', () => {
  it.each([
    ['server renderer', () => renderArticleHtml(article)!],
    [
      'client body',
      () =>
        renderToStaticMarkup(
          createElement(ArticleReadOnlyBody, { content: article })
        ),
    ],
  ])(
    'the %s renders own-storage, Unsplash and Arweave images and leaves out the others',
    (_, render) => {
      const seen = inspect(render())
      expect(seen.images).toEqual([own, unsplash, arweave])
      // An empty hidden block in each refused image's place: no layout box.
      expect(seen.hidden).toEqual([
        { hidden: true, html: '' },
        { hidden: true, html: '' },
      ])
      expect(seen.html).not.toContain('someone-else-456')
      expect(seen.text).toBe('Before.After.')
    }
  )

  it('the server HTML and the client body render refused images the same way', () => {
    const blocked: JSONContent = { type: 'doc', content: [image(otherSite)] }
    const server = inspect(renderArticleHtml(blocked)!).hidden
    const client = inspect(
      renderToStaticMarkup(
        createElement(ArticleReadOnlyBody, { content: blocked })
      )
    ).hidden
    expect(server).toEqual(client)
  })

  it("the editors' image node writes HTML only for listed images", () => {
    // The highlight view and the editors serialise through this node.
    const seen = inspect(
      generateHTML(article, [
        StarterKit.configure({ link: false }),
        ResizableImage,
      ])
    )
    expect(seen.images).toEqual([own, unsplash, arweave])
    expect(seen.hidden).toHaveLength(2)
  })

  const nodeView = (src: string, isEditable: boolean) =>
    inspect(
      renderToStaticMarkup(
        createElement(ResizableImageComponent, {
          node: { attrs: { src, alt: 'An image' } },
          editor: {
            isEditable,
            storage: { resizableImage: { shouldFocus: false } },
          },
          selected: false,
          updateAttributes: () => {},
        } as never)
      )
    )

  it('the highlight view shows listed images and nothing for the others', () => {
    for (const src of [own, unsplash, arweave]) {
      expect(nodeView(src, false).images).toEqual([src])
    }
    for (const src of [otherConvex, otherSite]) {
      const seen = nodeView(src, false)
      expect(seen.images).toEqual([])
      expect(seen.hidden).toEqual([{ hidden: true, html: '' }])
    }
  })

  it('an editor shows a note in place of an image from another host', () => {
    const seen = nodeView(otherConvex, true)
    expect(seen.images).toEqual([])
    expect(seen.text).toContain(
      'This image is not shown. Images must be uploaded or come from an allowed host.'
    )
    expect(nodeView(own, true).images).toEqual([own])
  })

  const writingView = (src: string) =>
    inspect(
      renderToStaticMarkup(
        createElement(WritingImageView, {
          node: { attrs: { src, alt: 'An image', title: null, width: null } },
          editor: {
            isEditable: true,
            storage: { resizableImage: { shouldFocus: false } },
            commands: { setNodeSelection: () => true },
            getJSON: () => ({ type: 'doc', content: [] }),
          },
          selected: false,
          updateAttributes: () => {},
          deleteNode: () => {},
          getPos: () => 0,
        } as never)
      )
    )

  it('the writing workspace shows its note, not the image, for another host', () => {
    const seen = writingView(otherConvex)
    expect(seen.images).toEqual([])
    expect(seen.html).not.toContain('someone-else-456')
    expect(seen.text).toContain(
      'This image is not shown. Images must be uploaded or come from an allowed host. Choose it to replace or remove it.'
    )
    expect(writingView(own).images).toEqual([own])
  })

  it('the writing editor and its image dialog use the same check', () => {
    const read = (path: string) =>
      readFileSync(join(__dirname, '../..', path), 'utf8')
    expect(read('components/editor/WritingImage.tsx')).toContain(
      'isArticleImageShown(node.attrs.src) ?'
    )
    const media = read('components/editor/WritingMedia.tsx')
    expect(media).toContain('if (!isArticleImageShown(url.trim())) {')
    expect(media).toContain('setError(imageSourceRefusal(url.trim()))')
  })
})
