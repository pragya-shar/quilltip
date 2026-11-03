import { test, expect, type Locator } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'

// Exercise the real TipTap mark/decorations and production styles, without
// account credentials, backend writes or changing saved passage records.
const bundle = build({
  stdin: {
    contents: `
      import { Editor } from '@tiptap/core'
      import StarterKit from '@tiptap/starter-kit'
      import Highlight from './components/editor/extensions/HighlightExtension'
      const colors = ['#F59E0B', '#10B981', '#3B82F6', '#F43F5E', '#8B5CF6', '#FB7185']
      const editor = new Editor({
        element: document.querySelector('#editor'),
        editable: false,
        extensions: [StarterKit, Highlight],
        content: { type: 'doc', content: colors.map((color, i) => ({
          type: 'paragraph', content: [{ type: 'text', text: 'A saved passage with emphasis',
            marks: [{ type: 'highlight', attrs: { id: 'passage-' + i,
              color, userId: 'reader', userName: 'Reader', createdAt: 1,
              overlapCount: i + 1 } }, { type: 'bold' }] }]
        })) }
      })
    `,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'iife',
})

async function contrast(mark: Locator) {
  return mark.evaluate((element) => {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    const luminance = (color: string) => {
      ctx.fillStyle = color
      ctx.fillRect(0, 0, 1, 1)
      const rgb = [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3)
      const linear = rgb.map((channel) => {
        const value = channel / 255
        return value <= 0.04045
          ? value / 12.92
          : ((value + 0.055) / 1.055) ** 2.4
      })
      return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722
    }
    const ink = luminance(getComputedStyle(element).color)
    const fill = luminance(getComputedStyle(element).backgroundColor)
    return (Math.max(ink, fill) + 0.05) / (Math.min(ink, fill) + 0.05)
  })
}

for (const theme of ['light', 'dark']) {
  for (const width of [1440, 390]) {
    test(`${theme} saved passages remain readable at ${width}px in every interaction state`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.setContent(
        `<html class="${theme}"><body><button id="before-editor">Before passages</button><article class="published-prose prose"><div id="editor"></div></article></body></html>`
      )
      for (const path of [
        'app/shared-ui.css',
        'app/highlights.css',
        'components/articles/reader.css',
      ]) {
        await page.addStyleTag({ content: await readFile(path, 'utf8') })
      }
      await page.addStyleTag({
        content:
          'body { --background: var(--ui-surface); --border: var(--ui-border); background: var(--ui-surface); color: var(--ui-foreground); }',
      })
      await page.addScriptTag({ content: (await bundle).outputFiles[0]!.text })
      const marks = page.locator('mark[data-highlight-id]')
      await expect(marks).toHaveCount(6)
      const before = await marks.evaluateAll((elements) =>
        elements.map((el) => ({
          id: el.getAttribute('data-highlight-id'),
          color: el.getAttribute('data-color'),
          text: el.textContent,
        }))
      )
      for (const [index, mark] of (await marks.all()).entries()) {
        await expect.poll(() => contrast(mark)).toBeGreaterThanOrEqual(4.5)
        // One prototype rose treatment regardless of stored color or overlap.
        await expect(mark).toHaveCSS('background-color', 'rgb(220, 182, 188)')
        await mark.hover()
        await expect.poll(() => contrast(mark)).toBeGreaterThanOrEqual(4.5)
        await expect(mark).toHaveCSS('background-color', 'rgb(207, 160, 170)')
        await page.mouse.down()
        await expect.poll(() => contrast(mark)).toBeGreaterThanOrEqual(4.5)
        await page.mouse.up()
        await page.mouse.move(0, 0)
        await mark.evaluate((el: HTMLElement) => {
          el.tabIndex = -1
          el.focus()
        })
        await expect(mark).toBeFocused()
        await expect.poll(() => contrast(mark)).toBeGreaterThanOrEqual(4.5)
      }

      // Enter the real tab order from a stable element outside the editor.
      await page.locator('#before-editor').click()
      for (const [index, mark] of (await marks.all()).entries()) {
        const control = page
          .locator('.highlight-attribution-control')
          .nth(index)
        await page.keyboard.press('Tab')
        await expect(control).toBeFocused()
        await expect(control).toHaveCSS('clip', 'auto')
        await expect(control).toHaveCSS('box-shadow', /0px 0px 0px 2px/)
        await expect(mark).toHaveCSS('outline-style', 'solid')
        await expect(mark).toHaveCSS('outline-width', '2px')
        if (index > 0) {
          await expect(marks.nth(index - 1)).toHaveCSS('outline-style', 'none')
        }
        await expect.poll(() => contrast(mark)).toBeGreaterThanOrEqual(4.5)
      }
      expect(
        await marks.evaluateAll((elements) =>
          elements.map((el) => ({
            id: el.getAttribute('data-highlight-id'),
            color: el.getAttribute('data-color'),
            text: el.textContent,
          }))
        )
      ).toEqual(before)
      await page.screenshot({ path: testInfo.outputPath('saved-passages.png') })
    })
  }
}
