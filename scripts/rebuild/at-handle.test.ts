import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { atHandleRedirect } from '@/lib/routing/atHandle'
import {
  LEGACY_WRITER_PAGE,
  legacyWriterPageServes,
} from '@/lib/routing/legacyWriterPage'

const at = (href: string) =>
  atHandleRedirect(new URL(href, 'https://quilltip.example'))?.href ?? null

describe('/@handle', () => {
  it('goes to the writer path, keeping the query', () => {
    expect(at('/@tomas')).toBe('https://quilltip.example/tomas')
    expect(at('/@tomas?ref=x&y=1')).toBe(
      'https://quilltip.example/tomas?ref=x&y=1'
    )
    expect(at('/@tomas/ledger')).toBe('https://quilltip.example/tomas/ledger')
    expect(at('/%40tomas')).toBe('https://quilltip.example/tomas')
    // A handle that starts like a reserved word is a writer: the proxy's
    // matcher lets it through.
    expect(at('/@apiary')).toBe('https://quilltip.example/apiary')
    expect(at('/@Tomas')).toBe('https://quilltip.example/Tomas')
  })

  it('never leaves the site or reaches an application route', () => {
    for (const href of [
      '/@shelf',
      '/@signin',
      '/@system/reading',
      '/@',
      '/@@tomas',
      '/@evil.com',
      '/@tomas%2F..%2Flogin',
      '/@a/b/c',
      '/tomas',
      '/@_next',
      '/@%E0%A4%A',
    ])
      expect(at(href), href).toBeNull()
    expect(
      atHandleRedirect(new URL('https://quilltip.example//@evil.com'))?.host ??
        'none'
    ).not.toBe('evil.com')
  })
})

describe('the legacy writer page font preloads', () => {
  it('follow the page that serves the route', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'tree-'))
    try {
      expect(legacyWriterPageServes(root)).toBe(false)
      mkdirSync(path.dirname(path.join(root, LEGACY_WRITER_PAGE)), {
        recursive: true,
      })
      writeFileSync(path.join(root, LEGACY_WRITER_PAGE), '')
      expect(legacyWriterPageServes(root)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
    // This tree: the legacy writer page still serves /{handle}.
    expect(legacyWriterPageServes()).toBe(true)
  })
})
