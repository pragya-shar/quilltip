import { useSyncExternalStore } from 'react'

// Stands in for Convex Auth in the sign-in fixture, behind the same two
// imports the app uses ('@convex-dev/auth/react' and 'convex/react'). The
// session lives in sessionStorage, so it survives the full page load after
// /signin. One account exists: reader@example.com / Correct1horse.
//   ?offline     every sign-in fails as a network error
//   ?slow-confirm  the backend answers the new token after 1.2 s
// A successful sign-in resolves first and the session is confirmed a
// moment later, as with a new token the backend has not answered yet.

const KEY = 'signin-fixture:auth'
const params = new URLSearchParams(location.search)

type State = {
  authenticated: boolean
  accounts: Record<string, string>
  signIns: number
}

function read(): State {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as State
  } catch {
    // Fall through to a fresh state.
  }
  return {
    authenticated: false,
    accounts: { 'reader@example.com': 'Correct1horse' },
    signIns: 0,
  }
}
let state = read()
let snapshot = { isLoading: false, isAuthenticated: state.authenticated }
const listeners = new Set<() => void>()
function write(next: State) {
  state = next
  sessionStorage.setItem(KEY, JSON.stringify(next))
  if (snapshot.isAuthenticated !== next.authenticated)
    snapshot = { isLoading: false, isAuthenticated: next.authenticated }
  listeners.forEach((listener) => listener())
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** The one reset code the fixture accepts. */
export const RESET_CODE = '12345678'

async function signIn(
  _provider: string,
  params_: {
    email: string
    password?: string
    flow: 'signIn' | 'signUp' | 'reset' | 'reset-verification'
    code?: string
    newPassword?: string
  }
) {
  await wait(250)
  if (params.has('offline')) throw new TypeError('Failed to fetch')
  const email = params_.email.toLowerCase()
  // Asking for a code answers the same for any email.
  if (params_.flow === 'reset') return { signingIn: false }
  if (params_.flow === 'reset-verification') {
    if (!state.accounts[email] || params_.code !== RESET_CODE)
      throw Object.assign(new Error('[CONVEX] Server Error'), {
        data: 'PASSWORD_RESET_INVALID_CODE',
      })
    if (
      !/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(params_.newPassword ?? '')
    )
      throw Object.assign(new Error('[CONVEX] Server Error'), {
        data: 'INVALID_PASSWORD',
      })
    write({
      ...state,
      accounts: { ...state.accounts, [email]: params_.newPassword! },
      authenticated: true,
    })
    return { signingIn: true }
  }
  const password = params_.password ?? ''
  if (params_.flow === 'signUp') {
    if (state.accounts[email])
      throw new Error(`Account ${email} already exists`)
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(password))
      throw Object.assign(new Error('[CONVEX] Server Error'), {
        data: 'INVALID_PASSWORD',
      })
    write({
      ...state,
      accounts: { ...state.accounts, [email]: password },
    })
  } else if (state.accounts[email] !== password) {
    throw new Error('InvalidSecret')
  }
  // The token is held; the backend answers it a moment later.
  setTimeout(
    () => write({ ...state, authenticated: true, signIns: state.signIns + 1 }),
    params.has('slow-confirm') ? 1200 : 300
  )
  return { signingIn: true }
}

async function signOut() {
  await wait(50)
  write({ ...state, authenticated: false })
}

export function useAuthActions() {
  return { signIn, signOut }
}

export function useConvexAuth() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => snapshot
  )
}

export const fixtureAuth = {
  isAuthenticated: () => state.authenticated,
  signIns: () => state.signIns,
}
