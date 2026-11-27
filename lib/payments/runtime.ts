'use client'

/**
 * The one React context the payments hooks read (`hooks/payments/*`). Its
 * default is the shell runtime: hooks that read `paymentsStore`, which the
 * engine fills once it has loaded. A fixture can provide its own runtime.
 * The shell's hooks call the same React hooks before and after the engine
 * arrives, so nothing remounts or resets when it does.
 */
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useSyncExternalStore,
} from 'react'
import { paymentsStore, shellController, type PaymentsState } from './store'
import type { PaymentsRuntime, TipMeta, TipTarget } from './types'

function useStore<T>(select: (s: PaymentsState) => T): T {
  return useSyncExternalStore(
    paymentsStore.subscribe,
    () => select(paymentsStore.get()),
    () => select(paymentsStore.get())
  )
}

/** Controllers made before the engine: one per id, stable between reads. */
const shellControllers = new Map<
  string,
  { key: string; value: ReturnType<typeof shellController> }
>()

function useShellTip(target: TipTarget, meta: TipMeta) {
  const id = useId()
  useEffect(
    () => paymentsStore.register(id, { target, meta }),
    [id, target, meta]
  )
  return useStore((s) => {
    const computed = s.tips[id]
    if (computed) return computed
    const key = `${s.auth}:${s.engine}:${id in s.queuedTaps}`
    const cached = shellControllers.get(id)
    if (cached && cached.key === key) return cached.value
    const value = shellController(id)
    shellControllers.set(id, { key, value })
    return value
  })
}

export const shellRuntime: PaymentsRuntime = {
  useBalance: () => useStore((s) => s.balance),
  useTip: useShellTip,
  useActivity: (role) => {
    useEffect(
      () => (role === 'writer' ? paymentsStore.watch('writer') : undefined),
      [role]
    )
    return useStore((s) =>
      role === 'reader' ? s.readerActivity : s.writerActivity
    )
  },
  useEarnings: () => {
    useEffect(() => paymentsStore.watch('earnings'), [])
    return useStore((s) => s.earnings)
  },
}

export const PaymentsRuntimeContext =
  createContext<PaymentsRuntime>(shellRuntime)

export function usePaymentsRuntime(): PaymentsRuntime {
  return useContext(PaymentsRuntimeContext)
}
