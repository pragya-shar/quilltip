import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import { ArweaveStatus } from '../../components/articles/ArweaveStatus'
import { isArweaveStatus } from '../../lib/arweave/types'

const render = (status?: string) =>
  renderToStaticMarkup(createElement(ArweaveStatus, { status }))

test.each([
  ['pending', 'Uploading to Arweave'],
  ['uploaded', 'Confirming on Arweave'],
  ['verified', 'Permanently stored'],
  ['failed', 'Upload failed'],
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
