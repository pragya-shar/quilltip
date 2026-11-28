// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { renderReadingHtml } from '@/lib/tiptap/renderReadingHtml'
import { safeYoutubeSrc, youtubeId } from '@/lib/tiptap/sanitizeReadingDoc'

// A video embed renders one shape only: the id taken from a known YouTube
// address, rebuilt as a no-cookie embed, in a frame whose attributes the
// renderer writes. Nothing from the author's address or attributes is kept.

const ID = 'dQw4w9WgXcQ'
const EMBED = `https://www.youtube-nocookie.com/embed/${ID}`
const SOURCES = { storageOrigin: null }

describe('youtubeId', () => {
  it('reads the id from the known address forms', () => {
    for (const src of [
      `https://www.youtube.com/watch?v=${ID}`,
      `https://youtube.com/watch?v=${ID}&list=PL1&t=30`,
      `https://m.youtube.com/watch?v=${ID}`,
      `https://youtu.be/${ID}`,
      `https://youtu.be/${ID}?autoplay=1`,
      `https://www.youtube.com/embed/${ID}?autoplay=1&mute=1&enablejsapi=1&origin=https://evil.example`,
      `https://www.youtube-nocookie.com/embed/${ID}`,
      `https://www.youtube.com/shorts/${ID}`,
      `https://www.youtube.com/live/${ID}`,
      `  https://www.youtube.com/watch?v=${ID}  `,
    ])
      expect(youtubeId(src), src).toBe(ID)
  })

  it('refuses every other address', () => {
    for (const src of [
      'https://www.youtube.com/redirect?q=https://evil.example/&x=/embed/',
      'https://www.youtube.com/account?x=/embed/',
      'https://www.youtube.com/logout#/embed/',
      'https://www.youtube.com/',
      'https://www.youtube.com/watch?v=a"b<c>&list=PL1',
      'https://www.youtube.com/playlist?list=PLxyz',
      `https://user:pw@www.youtube.com/embed/${ID}`,
      `https://www.youtube.com:8443/embed/${ID}`,
      `https://www.youtube.com./embed/${ID}`,
      'https://WWW.YouTube.com/embed/../redirect?q=//evil.example',
      'https://youtu.be/#/..\\redirect?q=https://evil.example',
      `https://www.youtube.com/embed/${ID}" onload="alert(1)`,
      'https://music.youtube.com/watch?v=abc',
      `https://www.youtube.com/v/${ID}?version=3&autoplay=1`,
      'https://www.youtube.com/embed/?listType=search&list=anything',
      `https://www.youtube.com/embed/${ID}/extra`,
      `http://www.youtube.com/watch?v=${ID}`,
      `https://youtube.evil.example/embed/${ID}`,
      `https://evil.example/embed/${ID}`,
      'https://www.youtube.com/@channel',
      `javascript:alert('${ID}')`,
      `/embed/${ID}`,
      'https://www.youtube.com/watch?v=short',
      `https://www.youtube.com/watch?v=${ID}x`,
      `https://www.youtube.com/watch?v=${ID.slice(0, 10)}%00`,
      7,
      null,
    ])
      expect(youtubeId(src), String(src)).toBeNull()
  })

  it('rebuilds the embed from the id alone', () => {
    expect(
      safeYoutubeSrc(`https://www.youtube.com/embed/${ID}?autoplay=1&loop=1`)
    ).toBe(EMBED)
  })
})

describe('the embed frame', () => {
  it('has the fixed attributes and no author attribute', () => {
    const { html } = renderReadingHtml(
      {
        type: 'doc',
        content: [
          {
            type: 'youtube',
            attrs: {
              src: `https://youtu.be/${ID}?autoplay=1`,
              start: 5,
              width: 9999,
              height: 1,
              class: 'x',
              autoplay: true,
              allow: 'camera; microphone',
              sandbox: 'allow-top-navigation',
              srcdoc: '<script>alert(1)</script>',
            },
          },
        ],
      },
      SOURCES
    )
    // An inert template: the frame never loads.
    const template = document.createElement('template')
    template.innerHTML = html!
    const root = template.content
    expect(root.children).toHaveLength(1)
    const wrap = root.children[0]!
    expect(wrap.tagName).toBe('DIV')
    expect(Array.from(wrap.attributes).map((a) => a.name)).toEqual([
      'data-youtube-video',
    ])
    expect(wrap.children).toHaveLength(1)
    const frame = wrap.children[0]!
    expect(
      Object.fromEntries(Array.from(frame.attributes, (a) => [a.name, a.value]))
    ).toEqual({
      src: EMBED,
      title: 'YouTube video',
      width: '640',
      height: '360',
      loading: 'lazy',
      referrerpolicy: 'strict-origin-when-cross-origin',
      sandbox: 'allow-scripts allow-same-origin allow-presentation',
      allow: 'encrypted-media; picture-in-picture; fullscreen',
      allowfullscreen: 'true',
    })
  })

  it('drops an embed whose address is refused, and keeps the rest', () => {
    const { html } = renderReadingHtml(
      {
        type: 'doc',
        content: [
          { type: 'youtube', attrs: { src: 'https://evil.example/embed' } },
          { type: 'paragraph', content: [{ type: 'text', text: 'After.' }] },
        ],
      },
      SOURCES
    )
    expect(html).toBe('<p id="s-0-0">After.</p>')
  })
})
