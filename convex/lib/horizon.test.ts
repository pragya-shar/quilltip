/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest'
import { verifyTipTransaction } from './horizon'

const HORIZON = 'https://horizon-testnet.stellar.org'
const TX = 'abc123'
const SOURCE = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV'

function makeFetch(
  response:
    | { status: number; ok?: boolean; body?: unknown; jsonThrows?: boolean }
    | { throws: true }
) {
  return async (url: string) => {
    if ('throws' in response) {
      throw new Error('network down')
    }
    expect(url.startsWith(HORIZON)).toBe(true)
    expect(url.includes(TX)).toBe(true)
    return {
      status: response.status,
      ok: response.ok ?? (response.status >= 200 && response.status < 300),
      json: async () => {
        if (response.jsonThrows) throw new Error('bad json')
        return response.body
      },
    }
  }
}

describe('verifyTipTransaction', () => {
  it('returns ok=true when the tx is successful and source matches', async () => {
    const fetchImpl = makeFetch({
      status: 200,
      body: { successful: true, source_account: SOURCE, ledger: 12345 },
    })

    const result = await verifyTipTransaction(fetchImpl, {
      txId: TX,
      expectedSource: SOURCE,
      horizonUrl: HORIZON,
    })
    expect(result).toEqual({ ok: true, ledger: 12345, onChainStroops: null })
  })

  it('returns transient not_found on 404 (Horizon propagation lag)', async () => {
    const fetchImpl = makeFetch({ status: 404 })
    const result = await verifyTipTransaction(fetchImpl, {
      txId: TX,
      expectedSource: SOURCE,
      horizonUrl: HORIZON,
    })
    expect(result).toEqual({
      ok: false,
      kind: 'transient',
      reason: 'not_found',
    })
  })

  it('returns transient server_error on 5xx', async () => {
    const fetchImpl = makeFetch({ status: 503 })
    const result = await verifyTipTransaction(fetchImpl, {
      txId: TX,
      expectedSource: SOURCE,
      horizonUrl: HORIZON,
    })
    expect(result).toEqual({
      ok: false,
      kind: 'transient',
      reason: 'server_error',
    })
  })

  it('returns transient network_error when fetch throws', async () => {
    const fetchImpl = makeFetch({ throws: true })
    const result = await verifyTipTransaction(fetchImpl, {
      txId: TX,
      expectedSource: SOURCE,
      horizonUrl: HORIZON,
    })
    expect(result).toEqual({
      ok: false,
      kind: 'transient',
      reason: 'network_error',
    })
  })

  it('returns permanent unsuccessful when successful=false', async () => {
    const fetchImpl = makeFetch({
      status: 200,
      body: { successful: false, source_account: SOURCE, ledger: 12345 },
    })
    const result = await verifyTipTransaction(fetchImpl, {
      txId: TX,
      expectedSource: SOURCE,
      horizonUrl: HORIZON,
    })
    expect(result).toEqual({
      ok: false,
      kind: 'permanent',
      reason: 'unsuccessful',
    })
  })

  it('returns permanent source_mismatch when source_account differs', async () => {
    const fetchImpl = makeFetch({
      status: 200,
      body: {
        successful: true,
        source_account: 'GDIFFERENT',
        ledger: 12345,
      },
    })
    const result = await verifyTipTransaction(fetchImpl, {
      txId: TX,
      expectedSource: SOURCE,
      horizonUrl: HORIZON,
    })
    expect(result).toEqual({
      ok: false,
      kind: 'permanent',
      reason: 'source_mismatch',
    })
  })

  it('returns permanent not_in_ledger when ledger is missing', async () => {
    const fetchImpl = makeFetch({
      status: 200,
      body: { successful: true, source_account: SOURCE },
    })
    const result = await verifyTipTransaction(fetchImpl, {
      txId: TX,
      expectedSource: SOURCE,
      horizonUrl: HORIZON,
    })
    expect(result).toEqual({
      ok: false,
      kind: 'permanent',
      reason: 'not_in_ledger',
    })
  })

  it('returns permanent malformed_response on unexpected shape', async () => {
    const fetchImpl = makeFetch({
      status: 200,
      body: { unexpected: 'shape' },
    })
    const result = await verifyTipTransaction(fetchImpl, {
      txId: TX,
      expectedSource: SOURCE,
      horizonUrl: HORIZON,
    })
    expect(result).toEqual({
      ok: false,
      kind: 'permanent',
      reason: 'malformed_response',
    })
  })

  it('returns permanent malformed_response when json parsing throws', async () => {
    const fetchImpl = makeFetch({ status: 200, jsonThrows: true })
    const result = await verifyTipTransaction(fetchImpl, {
      txId: TX,
      expectedSource: SOURCE,
      horizonUrl: HORIZON,
    })
    expect(result).toEqual({
      ok: false,
      kind: 'permanent',
      reason: 'malformed_response',
    })
  })

  it('strips a trailing slash from horizonUrl', async () => {
    let capturedUrl = ''
    const fetchImpl = async (url: string) => {
      capturedUrl = url
      return {
        status: 200,
        ok: true,
        json: async () => ({
          successful: true,
          source_account: SOURCE,
          ledger: 1,
        }),
      }
    }
    await verifyTipTransaction(fetchImpl, {
      txId: TX,
      expectedSource: SOURCE,
      horizonUrl: `${HORIZON}/`,
    })
    expect(capturedUrl).toBe(`${HORIZON}/transactions/${TX}`)
  })
})
