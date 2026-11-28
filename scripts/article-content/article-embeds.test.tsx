// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  articleEmbedSrc,
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
})
