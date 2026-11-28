import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { storageForViewer } from '../../convex/permanentStorage'
import { ArticleStorageSection } from '../../components/articles/ArticleStorageSection'

/**
 * #679: a reader sees a finished upload or nothing; the writer sees their own
 * upload state. The rule lives in the Convex read, so a reader never receives
 * an unfinished or failed status.
 */
const STORED = {
  arweaveTxId: 'tx-123',
  arweaveUrl: 'https://arweave.net/tx-123',
  arweaveTimestamp: 1_795_000_000_000,
  arweaveErrorMessage: 'upstream 502',
  arweaveVerifyAttempts: 3,
}
const row = (arweaveStatus?: string) => ({ ...STORED, arweaveStatus })

const panel = (fields: ReturnType<typeof storageForViewer>) =>
  renderToStaticMarkup(
    createElement(ArticleStorageSection, {
      status: fields.arweaveStatus,
      txId: fields.arweaveTxId,
      url: fields.arweaveUrl,
      timestamp: fields.arweaveTimestamp,
    })
  )

const NOTHING = {
  arweaveStatus: undefined,
  arweaveTxId: undefined,
  arweaveUrl: undefined,
  arweaveTimestamp: undefined,
  arweaveErrorMessage: undefined,
  arweaveVerifyAttempts: undefined,
}
const SHOWN = (arweaveStatus: string) => ({
  ...NOTHING,
  arweaveStatus,
  arweaveTxId: STORED.arweaveTxId,
  arweaveUrl: STORED.arweaveUrl,
  arweaveTimestamp: STORED.arweaveTimestamp,
})

describe.each([true, false])('permanent storage on: %s', (enabled) => {
  test('a finished upload goes to everyone, with its link', () => {
    for (const owner of [false, true]) {
      const fields = storageForViewer(row('verified'), owner, enabled)
      expect(fields).toEqual(SHOWN('verified'))
      expect(panel(fields)).toContain('Permanently stored')
    }
  })

  test.each(['pending', 'uploaded', 'failed', 'queued', undefined])(
    'a reader gets nothing for %s',
    (status) => {
      const fields = storageForViewer(row(status), false, enabled)
      expect(fields).toEqual(NOTHING)
      expect(panel(fields)).toBe('')
    }
  )

  test('the writer keeps an upload in progress, and a failed one with what to do', () => {
    expect(storageForViewer(row('uploaded'), true, enabled)).toEqual(
      SHOWN('uploaded')
    )
    const failed = storageForViewer(row('failed'), true, enabled)
    expect(failed).toEqual(SHOWN('failed'))
    const html = panel(failed)
    expect(html).toContain('Not stored permanently')
    expect(html).toContain('Contact Quilltip to try again')
    expect(html).not.toContain('Upload failed')
    expect(storageForViewer(row(undefined), true, enabled)).toEqual(NOTHING)
  })
})

test('a pending upload says nothing while permanent storage is off, even to the writer', () => {
  expect(storageForViewer(row('pending'), true, true)).toEqual(SHOWN('pending'))
  expect(storageForViewer(row('pending'), true, false)).toEqual(NOTHING)
})

test('spread over the document, the result replaces every stored field', () => {
  const doc = { title: 'An article', ...row('failed') }
  const forReader = { ...doc, ...storageForViewer(doc, false, true) }
  expect(forReader.title).toBe('An article')
  for (const key of Object.keys(NOTHING) as (keyof typeof NOTHING)[]) {
    expect(forReader[key]).toBeUndefined()
  }
  // The error message and retry count never leave the backend.
  const forWriter = { ...doc, ...storageForViewer(doc, true, true) }
  expect(forWriter.arweaveErrorMessage).toBeUndefined()
  expect(forWriter.arweaveVerifyAttempts).toBeUndefined()
})
