export type AuthIntent = 'write' | 'read' | 'default'

export interface AuthPageCopy {
  heading: string
  subtitle: string
  submitLabel: string
  submitLoadingLabel: string
  successMessage: string
}

function getPathname(returnPath: string): string {
  const queryIndex = returnPath.indexOf('?')
  return queryIndex === -1 ? returnPath : returnPath.slice(0, queryIndex)
}

export function getAuthIntent(returnPath: string): AuthIntent {
  const pathname = getPathname(returnPath)

  if (pathname === '/write' || pathname.startsWith('/write/')) {
    return 'write'
  }

  if (pathname === '/articles' || pathname.startsWith('/articles/')) {
    return 'read'
  }

  return 'default'
}

const REGISTER_COPY: Record<AuthIntent, AuthPageCopy> = {
  write: {
    heading: 'Create your account',
    subtitle: "You'll go straight to the editor after signup.",
    submitLabel: 'Create account and start writing',
    submitLoadingLabel: 'Creating account...',
    successMessage: 'Account created successfully! Opening the editor...',
  },
  read: {
    heading: 'Create your account',
    subtitle: 'Sign up to browse articles and tip writers on testnet.',
    submitLabel: 'Create account and start reading',
    submitLoadingLabel: 'Creating account...',
    successMessage: 'Account created successfully! Taking you to articles...',
  },
  default: {
    heading: 'Create your account',
    subtitle: 'Create your account to write, publish, and receive tips.',
    submitLabel: 'Create account',
    submitLoadingLabel: 'Creating account...',
    successMessage: 'Account created successfully! Redirecting...',
  },
}

const LOGIN_COPY: Record<AuthIntent, AuthPageCopy> = {
  write: {
    heading: 'Sign in to your account',
    subtitle: 'Sign in to continue writing.',
    submitLabel: 'Sign in and continue writing',
    submitLoadingLabel: 'Signing in...',
    successMessage: 'Signed in successfully! Opening the editor...',
  },
  read: {
    heading: 'Sign in to your account',
    subtitle: 'Sign in to browse articles and tip writers.',
    submitLabel: 'Sign in and start reading',
    submitLoadingLabel: 'Signing in...',
    successMessage: 'Signed in successfully! Taking you to articles...',
  },
  default: {
    heading: 'Sign in to your account',
    subtitle: 'Welcome back! Please enter your details.',
    submitLabel: 'Sign in',
    submitLoadingLabel: 'Signing in...',
    successMessage: 'Signed in successfully! Redirecting...',
  },
}

export function getRegisterCopy(returnPath: string): AuthPageCopy {
  return REGISTER_COPY[getAuthIntent(returnPath)]
}

export function getLoginCopy(returnPath: string): AuthPageCopy {
  return LOGIN_COPY[getAuthIntent(returnPath)]
}
