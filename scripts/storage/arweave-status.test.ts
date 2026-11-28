import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { ArticleStorageSection } from '../../components/articles/ArticleStorageSection'
import { ArweaveStatus } from '../../components/articles/ArweaveStatus'
import { isArweaveStatus } from '../../lib/arweave/types'

const render = (status?: string) =>
  renderToStaticMarkup(createElement(ArweaveStatus, { status }))

test.each([
  ['pending', 'Uploading to Arweave'],
  ['uploaded', 'Confirming on Arweave'],
  ['verified', 'Permanently stored'],
  ['failed', 'Not stored permanently'],
])('the %s status reads "%s"', (status, label) => {
  expect(render(status)).toContain(label)
})

test.each([undefined, '', 'queued', 'PENDING'])(
  'no status or an unknown one (%j) renders nothing',
  (status) => {
    expect(render(status)).toBe('')
    expect(isArweaveStatus(status)).toBe(false)
  }
)

const renderSection = (status?: string | null) =>
  renderToStaticMarkup(createElement(ArticleStorageSection, { status }))

test('the details section shows its heading and the label for a known status', () => {
  const html = renderSection('pending')
  expect(html).toContain('Permanent Storage')
  expect(html).toContain('Uploading to Arweave')
})

test.each([undefined, null, '', 'queued'])(
  'the details section renders no heading for no status or an unknown one (%j)',
  (status) => {
    expect(renderSection(status)).toBe('')
  }
)
