/**
 * Content security policy for every page response. `proxy.ts` builds it per
 * request with a fresh nonce. Next.js reads the nonce from the request's
 * `Content-Security-Policy` header and adds it to its own inline and external
 * scripts, so `script-src` needs neither `'unsafe-inline'` nor
 * `'unsafe-eval'`.
 *
 * The policy is pure: it reads only the values passed in, so tests can assert
 * it without a server. The connect, frame and image allowlists below are the
 * complete set of third-party origins the browser talks to.
 */

import { STELLAR_NETWORK_DEFAULTS } from '@/lib/stellar/network'

export type ContentSecurityPolicyEnv = {
  NEXT_PUBLIC_CONVEX_URL?: string
  NEXT_PUBLIC_HORIZON_URL?: string
  NEXT_PUBLIC_SOROBAN_RPC_URL?: string
  NEXT_PUBLIC_STELLAR_RPC_URL?: string
  VERCEL_ENV?: string
}

function originOf(value: string): string {
  return new URL(value).origin
}

/**
 * Stellar testnet endpoints the client may call: Horizon, Soroban RPC and
 * Friendbot (practice-wallet funding). The configured Horizon and RPC origins
 * are added to these, so switching `NEXT_PUBLIC_SOROBAN_RPC_URL` to another
 * testnet provider updates the policy in the same build. The network guard in
 * `lib/stellar/config.ts` refuses mainnet endpoints before any call.
 */
export const STELLAR_TESTNET_ORIGINS = [
  STELLAR_NETWORK_DEFAULTS.TESTNET.horizonUrl,
  STELLAR_NETWORK_DEFAULTS.TESTNET.rpcUrl ?? '',
  'https://friendbot.stellar.org',
].map(originOf)

/**
 * Stellar Wallets Kit, with the modules in `lib/stellar/v2/wallet-kit.ts`
 * (Varial, xBull, Albedo, LOBSTR, Rabet, Hana):
 * - The extension wallets and xBull's popup talk to the page through `window`
 *   and `postMessage`, so they need no entry.
 * - Albedo signs in a popup and keeps an implicit-flow session in an iframe.
 * - The wallet picker shows icons from the kit's CDN.
 *
 * HOT Wallet and WalletConnect are not offered, so their relays and frames are
 * not allowed. Adding either module means adding its origins here.
 */
export const WALLET_FRAME_ORIGINS = ['https://albedo.link']
export const WALLET_IMAGE_ORIGINS = ['https://stellar.creit.tech']

/** Hosts of images in articles, covers and avatars. */
const CONTENT_IMAGE_SOURCES = [
  '*.convex.cloud',
  '*.convex.site',
  'img.youtube.com',
  'images.unsplash.com',
  'plus.unsplash.com',
  'arweave.net',
]

const VIDEO_FRAME_ORIGINS = [
  'https://www.youtube.com',
  'https://www.youtube-nocookie.com',
]

/** Vercel's preview feedback toolbar. Previews only. */
const VERCEL_PREVIEW_ORIGIN = 'https://vercel.live'

/** The origin of a configured URL, or nothing when unset or malformed. */
function configuredOrigin(value: string | undefined): string[] {
  if (!value?.trim()) return []
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' || url.protocol === 'http:'
      ? [url.origin]
      : []
  } catch {
    return []
  }
}

/**
 * The Convex deployment the client syncs with: HTTPS for queries and the
 * matching WebSocket origin for the sync protocol.
 */
export function convexConnectSources(convexUrl: string | undefined): string[] {
  return configuredOrigin(convexUrl).flatMap((origin) => [
    origin,
    origin.replace(/^http/, 'ws'),
  ])
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

/** A nonce of 128 random bits, base64-encoded. */
export function createNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
}

/** Request header that carries the nonce from proxy.ts to server components. */
export const NONCE_HEADER = 'x-nonce'

export function buildContentSecurityPolicy(
  nonce: string,
  env: ContentSecurityPolicyEnv
): string {
  const isVercelPreview = env.VERCEL_ENV === 'preview'

  const directives: [string, string[]][] = [
    ['default-src', ["'self'"]],
    // No 'strict-dynamic': chunks that Next.js and Vercel Analytics add at
    // run time load from 'self', and host entries (the preview toolbar) keep
    // working.
    [
      'script-src',
      [
        "'self'",
        `'nonce-${nonce}'`,
        ...(isVercelPreview ? [VERCEL_PREVIEW_ORIGIN] : []),
      ],
    ],
    // Inline style attributes come from React (`style={...}`), Motion and the
    // wallet picker's web components, so styles keep 'unsafe-inline'. Styles
    // cannot run script.
    ['style-src', ["'self'", "'unsafe-inline'"]],
    [
      'img-src',
      unique([
        "'self'",
        'data:',
        'blob:',
        ...configuredOrigin(env.NEXT_PUBLIC_CONVEX_URL),
        ...CONTENT_IMAGE_SOURCES,
        ...WALLET_IMAGE_ORIGINS,
      ]),
    ],
    ['font-src', ["'self'"]],
    [
      'connect-src',
      unique([
        "'self'",
        ...convexConnectSources(env.NEXT_PUBLIC_CONVEX_URL),
        ...STELLAR_TESTNET_ORIGINS,
        ...configuredOrigin(env.NEXT_PUBLIC_HORIZON_URL),
        ...configuredOrigin(env.NEXT_PUBLIC_SOROBAN_RPC_URL),
        ...configuredOrigin(env.NEXT_PUBLIC_STELLAR_RPC_URL),
      ]),
    ],
    [
      'frame-src',
      [
        "'self'",
        ...VIDEO_FRAME_ORIGINS,
        ...WALLET_FRAME_ORIGINS,
        ...(isVercelPreview ? [VERCEL_PREVIEW_ORIGIN] : []),
      ],
    ],
    ['object-src', ["'none'"]],
    ['base-uri', ["'none'"]],
    ['form-action', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
  ]

  return directives
    .map(([name, sources]) => `${name} ${sources.join(' ')}`)
    .join('; ')
}
