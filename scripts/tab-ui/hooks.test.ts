// @vitest-environment happy-dom
/**
 * The tab screens' hooks with stand-in services: the operation state
 * machine (confirmation from indexed state, wallet refusal, Convex refusal,
 * resume after a reload) and the quick-tip hook with the real tab library.
 */
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import {
  act,
  createElement,
  useEffect,
  useReducer,
  type ReactNode,
} from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { TabServicesContext } from '../../hooks/tab/TabServicesContext'
import { useDeviceKey } from '../../hooks/tab/useDeviceKey'
import { useTabOperation } from '../../hooks/tab/useTabOperation'
import { useTabTip } from '../../hooks/tab/useTabTip'
import {
  createLocalLedger,
  createSessionKeyStore,
  type SessionKeyStore,
} from '../../lib/stellar/v2/tab'
import { writePendingOperation } from '../../lib/tab-ui/device-memory'
import type { MyTab, MyTabTips, TabServices } from '../../lib/tab-ui/types'
import {
  FakeTabServer,
  PASSPHRASE,
  READER,
  TAB,
  WRITER_G,
} from '../tab/helpers'
;(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const LEDGER = 1_000_000

function openTab(balance = '200000000', keys: MyTab['keys'] = []): MyTab {
  return {
    tabContractId: TAB,
    readerAddress: READER,
    status: 'OPEN',
    confirmedBalance: balance,
    outstanding: '0',
    available: balance,
    acceptedToday: '0',
    acceptedDay: '2026-11-27',
    withdrawUnlockLedger: null,
    keys,
    pairs: [],
  }
}

type World = {
  tab: MyTab | null
  tips: MyTabTips
  send: 'sent' | 'rejected' | 'balance'
  prepareCode: string | null
  listeners: Set<() => void>
  calls: string[]
}

function makeServices(world: World, store: SessionKeyStore): TabServices {
  // Re-render on world changes: a tiny external store.
  const useWorld = <T>(pick: () => T) => {
    const [, force] = useReducer((n: number) => n + 1, 0)
    useEffect(() => {
      world.listeners.add(force)
      return () => void world.listeners.delete(force)
    }, [])
    return pick()
  }
  const context = {
    tabContractId: TAB,
    tokenContractId: 'CTOKEN',
    readerAddress: READER,
    networkPassphrase: PASSPHRASE,
    currentLedger: LEDGER,
  }
  const refusal = () => {
    if (world.prepareCode)
      throw Object.assign(new Error(), {
        data: { code: world.prepareCode, message: 'refused' },
      })
  }
  return {
    config: () => ({ networkPassphrase: PASSPHRASE, tabContractId: TAB }),
    useMyTab: () => useWorld(() => world.tab),
    useMyTabTips: () => useWorld(() => (world.tab ? world.tips : null)),
    useMyTabEarnings: () => null,
    useChainConfig: () =>
      useWorld(
        () =>
          ({
            v2Enabled: true,
            tabContractId: TAB,
            paused: {},
          }) as never
      ),
    useTabSettlement: () => ({ settlementEnabled: true }),
    useWalletAccess: () => ({ gate: { kind: 'ready' }, address: READER }),
    prepareOpen: async () => (refusal(), context),
    prepareDeposit: async () => (refusal(), context),
    prepareRegisterKey: async () => (refusal(), context),
    prepareRevokeKey: async () => (refusal(), context),
    prepareWithdrawStart: async () => (refusal(), context),
    prepareWithdraw: async () => (
      refusal(),
      { ...context, withdrawUnlockLedger: null }
    ),
    prepareTip: async () => {
      throw new Error('set per test')
    },
    submitTip: async () => {
      throw new Error('set per test')
    },
    latestLedger: async () => ({ sequence: LEDGER, closedAt: Date.now() }),
    walletFunds: async () => null,
    tabLimits: async () => null,
    claimable: async () => '0',
    send: async (request, onStep) => {
      world.calls.push(request.call.method)
      onStep?.('simulating')
      onStep?.('signing')
      if (world.send === 'rejected')
        return { status: 'wallet_failed', error: { kind: 'rejected' } } as never
      if (world.send === 'balance')
        return {
          status: 'simulation_failed',
          error: {
            code: 10,
            name: 'BalanceError',
            contract: 'token',
            message: 'm',
          },
          detail: 'Error(Contract, #10)',
        } as never
      onStep?.('sending')
      return { status: 'sent', hash: 'aa'.repeat(32) }
    },
    poll: async () => 'SUCCESS',
    keyStore: () => store,
    signingDeps: (readerAddress) => ({
      keys: store,
      ledger: createLocalLedger(db),
      networkPassphrase: PASSPHRASE,
      tabContractId: TAB,
      readerAddress,
    }),
    now: () => Date.now(),
    newRequestId: () => `req-${Math.random().toString(36).slice(2)}`,
  }
}

let db: { indexedDB: IDBFactory; dbName: string }
let counter = 0
let container: HTMLElement
let root: ReturnType<typeof createRoot>

beforeEach(() => {
  counter += 1
  db = { indexedDB: new IDBFactory(), dbName: `hooks-${counter}` }
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  sessionStorage.clear()
  localStorage.clear()
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(services: TabServices, child: ReactNode) {
  act(() => {
    root.render(
      createElement(TabServicesContext.Provider, { value: services }, child)
    )
  })
}

async function until(check: () => boolean, ms = 3_000) {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
  }
}

function emit(world: World) {
  act(() => world.listeners.forEach((l) => l()))
}

type Op = ReturnType<typeof useTabOperation>

function OperationProbe(props: {
  services: TabServices
  world: World
  out: { op?: Op }
}) {
  const { services, world, out } = props
  const tab = services.useMyTab()
  const device = useDeviceKey(services, tab, null, READER)
  out.op = useTabOperation({
    surface: 'reader',
    services,
    address: READER,
    gate: { kind: 'ready' },
    tab,
    device,
  })
  void world
  return null
}

function newWorld(tab: MyTab | null): World {
  return {
    tab,
    tips: {
      settlementEnabled: true,
      oldestUnsettledAt: null,
      settleWindowEndsSoon: false,
      tips: [],
    },
    send: 'sent',
    prepareCode: null,
    listeners: new Set(),
    calls: [],
  }
}

describe('useTabOperation', () => {
  it('top-up: checking once sent, confirmed only when the indexed balance rises', async () => {
    const world = newWorld(openTab())
    const services = makeServices(world, createSessionKeyStore(db))
    const out: { op?: Op } = {}
    render(services, createElement(OperationProbe, { services, world, out }))
    await act(async () => {
      await out.op!.start({ flow: 'tab-top-up', amount: '50000000' })
    })
    expect(world.calls).toEqual(['deposit'])
    expect(out.op!.view).toMatchObject({ kind: 'progress', flow: 'tab-top-up' })
    expect(out.op!.applied).toBe(false)
    expect(sessionStorage.getItem('quilltip-tab-pending-operation')).toContain(
      'tab-top-up'
    )
    world.tab = openTab('250000000')
    emit(world)
    expect(out.op!.applied).toBe(true)
    expect(sessionStorage.getItem('quilltip-tab-pending-operation')).toBeNull()
  })

  it('a wallet refusal shows declined, and a retry reuses the pending key', async () => {
    const world = newWorld(openTab())
    world.send = 'rejected'
    const store = createSessionKeyStore(db)
    const services = makeServices(world, store)
    const out: { op?: Op } = {}
    render(services, createElement(OperationProbe, { services, world, out }))
    await until(() => out.op !== undefined)
    await act(async () => {
      await out.op!.start({ flow: 'tab-new-key' })
    })
    const view = out.op!.view
    expect(
      view.kind === 'progress' &&
        'tabOperation' in view.source &&
        view.source.declined
    ).toBe(true)
    const scope = { tabContractId: TAB, readerAddress: READER }
    const first = (await store.list(scope)).map((k) => k.info.publicKey)
    expect(first).toHaveLength(1)
    world.send = 'sent'
    await act(async () => {
      await out.op!.start({ flow: 'tab-new-key' })
    })
    expect((await store.list(scope)).map((k) => k.info.publicKey)).toEqual(
      first
    )
  })

  it('a Convex refusal and a token balance error stop before anything is signed', async () => {
    const world = newWorld(openTab())
    world.prepareCode = 'TAB_NO_ACCOUNT'
    const services = makeServices(world, createSessionKeyStore(db))
    const out: { op?: Op } = {}
    render(services, createElement(OperationProbe, { services, world, out }))
    await act(async () => {
      await out.op!.start({ flow: 'tab-close' })
    })
    expect(out.op!.view).toMatchObject({
      kind: 'refusal',
      refusal: { kind: 'notice', notice: { kind: 'tab-none' } },
    })
    expect(world.calls).toEqual([])
    world.prepareCode = null
    world.send = 'balance'
    await act(async () => {
      await out.op!.start({ flow: 'tab-top-up', amount: '1' })
    })
    expect(out.op!.view).toMatchObject({
      kind: 'notice',
      notice: { kind: 'insufficient-balance', source: 'wallet' },
    })
  })

  it('resumes an operation noted before a reload, without starting it again', async () => {
    writePendingOperation({
      flow: 'tab-close',
      reader: READER,
      hash: 'bb'.repeat(32),
      maxTime: Math.floor(Date.now() / 1000) + 300,
      startedAt: Date.now(),
    })
    const world = newWorld(openTab())
    const services = makeServices(world, createSessionKeyStore(db))
    const out: { op?: Op } = {}
    render(services, createElement(OperationProbe, { services, world, out }))
    await until(() => out.op?.view.kind === 'progress')
    expect(out.op!.view).toMatchObject({
      kind: 'progress',
      flow: 'tab-close',
      txHash: 'bb'.repeat(32),
    })
    expect(world.calls).toEqual([])
    world.tab = {
      ...openTab(),
      status: 'CLOSING',
      withdrawUnlockLedger: LEDGER + 51_840,
    }
    emit(world)
    expect(out.op!.applied).toBe(true)
  })
})

type Tip = ReturnType<typeof useTabTip>

function TipProbe(props: { out: { tip?: Tip }; recipientCount?: number }) {
  props.out.tip = useTabTip({
    articleId: 'a1',
    recipientCount: props.recipientCount ?? 1,
  })
  return null
}

describe('useTabTip', () => {
  it('tips with the device key and no wallet, then follows the receipt to settled', async () => {
    const store = createSessionKeyStore({ ...db, forceFallback: true })
    const scope = { tabContractId: TAB, readerAddress: READER }
    const key = await store.generate(scope)
    await store.bindKeyIds(scope, [{ keyId: 0, publicKey: key.info.publicKey }])
    const server = new FakeTabServer(new Map([[0, key.info.publicKey]]))
    const world = newWorld(
      openTab('200000000', [
        {
          keyId: 0,
          publicKey: key.info.publicKey,
          validUntilLedger: LEDGER + 7 * 17_280,
          spendLimit: '500000000',
          spentOnChain: '0',
          acceptedTotal: '0',
          revoked: false,
          extractable: true,
        },
      ])
    )
    const services = makeServices(world, store)
    services.prepareTip = async (args) =>
      server.prepare({
        keyId: args.keyId,
        writer: WRITER_G,
        amount: BigInt(args.amountCents) * BigInt(100_000),
      })
    services.submitTip = async (args) => server.submit(args)
    const out: { tip?: Tip } = {}
    render(services, createElement(TipProbe, { out }))
    await until(() => out.tip?.availability.kind === 'ready')
    let outcome
    await act(async () => {
      outcome = await out.tip!.send(25)
    })
    expect(outcome).toMatchObject({ kind: 'accepted', amount: '2500000' })
    expect(out.tip!.receiptStatus).toBe('ACCEPTED')
    expect(out.tip!.progress).toEqual({ tabTip: { status: 'ACCEPTED' } })
    const receiptId = (outcome as unknown as { receiptId: string }).receiptId
    world.tips = {
      ...world.tips,
      tips: [
        {
          receiptId,
          status: 'SETTLED',
          amount: '2500000',
          writer: WRITER_G,
          keyId: 0,
          seq: 1,
          articleTitle: 'A',
          articleSlug: 'a',
          authorName: 'Ada',
          authorUsername: 'ada',
          highlight: false,
          acceptedAt: Date.now(),
          settledTxHash: 'cc'.repeat(32),
        },
      ],
    }
    emit(world)
    expect(out.tip!.receiptStatus).toBe('SETTLED')
    expect(out.tip!.settledTxHash).toBe('cc'.repeat(32))
  })

  it('offers no tab tip for an article with co-author splits', async () => {
    const world = newWorld(openTab())
    const services = makeServices(world, createSessionKeyStore(db))
    const out: { tip?: Tip } = {}
    render(services, createElement(TipProbe, { out, recipientCount: 2 }))
    expect(out.tip!.availability).toEqual({ kind: 'splits' })
    let outcome
    await act(async () => {
      outcome = await out.tip!.send(25)
    })
    expect(outcome).toBeNull()
  })
})
