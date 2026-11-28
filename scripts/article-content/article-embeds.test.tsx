// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Editor, type JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { describe, expect, it } from 'vitest'
import { createReaderYoutubeNode } from '../../lib/tiptap/youtubeEmbed'
import {
  articleEmbedSrc,
  createYoutubeExtension,
  youtubeVideoId,
} from '../../lib/tiptap/youtubeExtension'
import { EMBED, ID, doc, inspect, readers, video } from './readers'

describe('video embeds (#615)', () => {
  it.each([
    [`https://www.youtube.com/watch?v=${ID}`, ID],
    [`https://youtube.com/watch?v=${ID}&t=30s`, ID],
    [`https://m.youtube.com/watch?v=${ID}`, ID],
    [`https://music.youtube.com/watch?v=${ID}`, ID],
    [`https://youtu.be/${ID}?si=abc`, ID],
    [`https://www.youtube.com/embed/${ID}?autoplay=1&mute=1`, ID],
    [`https://www.youtube-nocookie.com/embed/${ID}`, ID],
    [`https://www.youtube.com/shorts/${ID}`, ID],
    [`https://www.youtube.com/live/${ID}`, ID],
    [`http://www.youtube.com/v/${ID}`, ID],
    [' https://youtu.be/' + ID + ' ', ID],
    [`https://www.youtube.com/embed/videoseries?list=PL${ID}`, null],
    [`https://www.youtube.com/playlist?list=PL${ID}`, null],
    [`https://www.youtube.com/@channel`, null],
    [`https://www.youtube.com/watch?v=${ID}x`, null],
    [`https://www.youtube.com/watch?v=short`, null],
    [`https://www.youtube.com/embed/${ID}/extra`, null],
    [`https://youtube.com-x.example/embed/${ID}`, null],
    [`https://evil.example/embed/${ID}`, null],
    [`https://user@www.youtube.com/embed/${ID}`, null],
    [`https://www.youtube.com:8443/embed/${ID}`, null],
    [`javascript:alert(1)//www.youtube.com/embed/${ID}`, null],
    [`//www.youtube.com/embed/${ID}`, null],
    [42, null],
    [null, null],
  ])('youtubeVideoId(%j) is %j', (src, id) => {
    expect(youtubeVideoId(src)).toBe(id)
  })

  it('the embed address is the id on the no-cookie host with fixed parameters', () => {
    expect(
      articleEmbedSrc(`https://www.youtube.com/embed/${ID}?autoplay=1`, 0)
    ).toBe(EMBED)
    expect(articleEmbedSrc(`https://youtu.be/${ID}`, 30)).toBe(
      `https://www.youtube-nocookie.com/embed/${ID}?start=30&rel=1`
    )
    for (const start of [-5, 1.5, '30', Number.NaN, null]) {
      expect(articleEmbedSrc(`https://youtu.be/${ID}`, start)).toBe(EMBED)
    }
    expect(articleEmbedSrc('https://evil.example/', 0)).toBeNull()
  })

  it.each(readers)(
    'the %s rebuilds a stored embed address and renders no frame without a video id',
    (_, render) => {
      const html = render(
        doc(
          video(`https://www.youtube.com/embed/${ID}?autoplay=1&mute=1&loop=1`),
          video(`https://youtu.be/${ID}`, { start: 30, width: '1px' }),
          video(`https://www.youtube.com/embed/videoseries?list=PL${ID}`),
          video('https://evil.example/embed/x')
        )
      )
      expect(inspect(html)).toMatchObject({
        frames: [
          { src: EMBED, width: '640' },
          {
            src: `https://www.youtube-nocookie.com/embed/${ID}?start=30&rel=1`,
            width: '640',
          },
        ],
        hiddenVideos: 2,
      })
    }
  )

  // The readers use their own video node, so the article page does not
  // load @tiptap/extension-youtube; it must render what the editors render.
  it('the reader node and the editor extension render the same HTML', () => {
    const render = (
      extension: ReturnType<typeof createReaderYoutubeNode>,
      content: JSONContent
    ) => {
      const editor = new Editor({
        extensions: [StarterKit, extension],
        content,
        editable: false,
      })
      const html = editor.getHTML()
      const dom = editor.view.dom.innerHTML
      editor.destroy()
      return { html, dom }
    }
    const content = doc(
      video(`https://www.youtube.com/watch?v=${ID}`),
      video(`https://www.youtube.com/embed/${ID}?autoplay=1&mute=1`, {
        start: 30,
        width: 320,
        height: 180,
      }),
      video(`https://youtu.be/${ID}`, { start: -4, width: '1px' }),
      video(`https://www.youtube.com/embed/videoseries?list=PL${ID}`),
      video(null)
    )
    const reader = render(createReaderYoutubeNode(), content)
    const editor = render(
      createYoutubeExtension() as unknown as ReturnType<
        typeof createReaderYoutubeNode
      >,
      content
    )
    expect(reader.html).toBe(editor.html)
    expect(reader.dom).toBe(editor.dom)
    expect(inspect(reader.html)).toMatchObject({
      frames: [
        { src: EMBED, width: '640' },
        {
          src: `https://www.youtube-nocookie.com/embed/${ID}?start=30&rel=1`,
          width: '320',
        },
        { src: EMBED, width: '640' },
      ],
      hiddenVideos: 2,
    })
  })

  it('the reader paths do not import @tiptap/extension-youtube', () => {
    const root = join(__dirname, '../..')
    for (const file of [
      'lib/tiptap/readExtensions.ts',
      'lib/tiptap/youtubeEmbed.ts',
      'lib/articles/youtubeVideo.ts',
      'components/articles/HighlightableArticle.tsx',
    ]) {
      const source = readFileSync(join(root, file), 'utf8')
      expect(source, file).not.toMatch(
        /from '(@tiptap\/extension-youtube|[^']*\/youtubeExtension)'/
      )
    }
  })
})
