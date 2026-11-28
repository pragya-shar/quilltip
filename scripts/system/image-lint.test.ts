import path from 'node:path'
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'
import { SURFACE_PACKAGES } from '../eslint/surface-packages.mjs'

const root = path.join(__dirname, '../..')
const eslint = new ESLint({ cwd: root })

/** The image rule's messages for `code` as a file in a surface. */
async function imageErrors(code: string, file = 'components/read/Probe.tsx') {
  const [result] = await eslint.lintText(code, {
    filePath: path.join(root, file),
  })
  return (result?.messages ?? []).filter(
    (m) =>
      m.ruleId === 'no-restricted-syntax' ||
      m.ruleId === 'no-restricted-imports'
  )
}

describe('images in the shell and its surfaces', () => {
  it('covers every surface package in the segment registry', () => {
    expect(SURFACE_PACKAGES).toContain('read')
    expect(SURFACE_PACKAGES).toContain('today')
    expect(SURFACE_PACKAGES).not.toContain('legacy')
    expect(SURFACE_PACKAGES).not.toContain('foundation')
  })

  it.each([
    [
      'an img',
      `export const A = ({ src }: { src: string }) => <img src={src} alt="" />`,
    ],
    [
      'next/image',
      `import Image from 'next/image'\nexport const A = () => <Image src="/a.png" alt="" width={1} height={1} />`,
    ],
    [
      'an object or embed',
      `export const A = ({ src }: { src: string }) => <object data={src} />`,
    ],
    [
      'an embed',
      `export const A = ({ src }: { src: string }) => <embed src={src} />`,
    ],
    [
      'a video poster',
      `export const A = ({ src }: { src: string }) => <video poster={src} />`,
    ],
    [
      'an image input',
      `export const A = ({ src }: { src: string }) => <input type="image" src={src} alt="" />`,
    ],
    [
      'new Image',
      `export function a(src: string) { const i = new Image(); i.src = src; return i }`,
    ],
    ['a dynamic next/image', `export const load = () => import('next/image')`],
    [
      'next/legacy/image',
      `import Image from 'next/legacy/image'\nexport const A = () => <Image src="/a.png" alt="" width={1} height={1} />`,
    ],
    [
      'a picture source',
      `export const A = ({ src }: { src: string }) => <picture><source srcSet={src} /></picture>`,
    ],
    [
      'an SVG image',
      `export const A = ({ src }: { src: string }) => <svg><image href={src} /></svg>`,
    ],
    [
      'an image made in script',
      `export function a(src: string) { const i = document.createElement('img'); i.src = src; return i }`,
    ],
    [
      'a CSS background',
      `export const A = ({ src }: { src: string }) => <div style={{ backgroundImage: \`url(\${src})\` }} />`,
    ],
  ])('refuses %s in a surface', async (_name, code) => {
    expect((await imageErrors(code)).length).toBeGreaterThan(0)
  })

  it('refuses them in every surface directory and the shell', async () => {
    const code = `export const A = ({ src }: { src: string }) => <img src={src} alt="" />`
    for (const name of SURFACE_PACKAGES)
      expect(
        (await imageErrors(code, `components/${name}/Probe.tsx`)).length,
        name
      ).toBeGreaterThan(0)
    expect((await imageErrors(code, 'shell/Probe.tsx')).length).toBeGreaterThan(
      0
    )
  })

  it('refuses a CSS background shorthand with an address', async () => {
    const code =
      'export const A = ({ src }: { src: string }) => <div style={{ background: `url(${src}) center` }} />'
    expect((await imageErrors(code)).length).toBeGreaterThan(0)
  })

  it('lets a plain video and a text input through', async () => {
    const code =
      'export const A = () => <><video src="/a.mp4" /><input type="text" /></>'
    expect(await imageErrors(code)).toEqual([])
  })

  it('lets a colour or a token through', async () => {
    const code =
      'export const A = () => <span style={{ background: `var(--qt-ink)` }} />'
    expect(await imageErrors(code)).toEqual([])
  })

  it('lets Avatar draw a person', async () => {
    const code = `import { Avatar } from '@/system/components/Avatar'\nexport const A = ({ src }: { src: string }) => <Avatar name="Lena" src={src} />`
    expect(await imageErrors(code)).toEqual([])
  })
})
