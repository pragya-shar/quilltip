import type { NextConfig } from 'next'
import bundleAnalyzer from '@next/bundle-analyzer'
import { walletConnectProjectId } from './lib/stellar/v2/walletconnect-gate'

// WalletConnect is on with a Reown project ID and off without one
// (lib/stellar/v2/walletconnect-gate.ts). A malformed ID stops the build,
// the dev server and `next start`.
walletConnectProjectId(process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID)

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
  openAnalyzer: false,
})

const nextConfig: NextConfig = {
  // Vercel builds with immutable asset paths (`/_next/static/immutable/`).
  // QUILLTIP_IMMUTABLE_ASSETS=1 makes a local build match, for measurements
  // such as scripts/perf/tap-to-visible.ts. Off for every other build.
  ...(process.env.QUILLTIP_IMMUTABLE_ASSETS === '1' && {
    supportsImmutableAssets: true,
  }),
  // Put page metadata in <head> for every client, not only Next's built-in bot
  // list, so all crawlers and link previews see article titles and tags. Pages
  // that set metadata already await the same data, so nothing is delayed.
  htmlLimitedBots: /.*/,
  // Playwright's default base URL is http://127.0.0.1:3100. `next dev` serves
  // its client bundles only to allowed hosts, so without this a page opened on
  // 127.0.0.1 never hydrates. Development server only.
  allowedDevOrigins: ['127.0.0.1'],
  // Pages render per request (proxy.ts adds a CSP nonce). React would then
  // send font preloads as Link response headers, so fonts start before the
  // HTML is parsed and compete with the render-blocking stylesheets. Keep
  // preloads in the HTML, where the browser fetches stylesheets first, as it
  // did when these pages were prerendered.
  reactMaxHeadersLength: 0,
  turbopack: {
    resolveAlias: {
      '@ngneat/elf-devtools': './lib/stubs/elf-devtools.ts',
    },
  },
  images: {
    // AVIF first: article covers are the largest bytes on list pages.
    formats: ['image/avif', 'image/webp'],
    ...(process.env.NODE_ENV === 'development' && {
      dangerouslyAllowLocalIP: true,
    }),
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.convex.cloud',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: '*.convex.site',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'img.youtube.com',
        port: '',
        pathname: '/vi/**',
      },
      // Local Convex dev server
      {
        protocol: 'http',
        hostname: '127.0.0.1',
        port: '3210',
        pathname: '/api/storage/**',
      },
      // Temporary: Allow Unsplash for legacy content
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'plus.unsplash.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'arweave.net',
        port: '',
        pathname: '/**',
      },
    ],
  },
}

export default withBundleAnalyzer(nextConfig)
