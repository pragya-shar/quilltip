import Youtube from '@tiptap/extension-youtube'

export function createYoutubeExtension() {
  return Youtube.configure({
    width: 640,
    height: 480,
    controls: true,
    nocookie: true,
    allowFullscreen: true,
    HTMLAttributes: {
      class: 'youtube-embed rounded-lg my-4',
    },
  })
}
