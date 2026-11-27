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
  // Vercel serves chunks from /_next/static/immutable/chunks/ (its adapter
  // turns this on). CI builds once with it to check that the Next.js patch
  // handles that path too (perf:chunk-paths); deployments do not set it here.
  ...(process.env.QUILLTIP_IMMUTABLE_ASSETS === '1' && {
    experimental: { supportsImmutableAssets: true },
  }),
  // The chunk loader of patches/next@16.4.6.ts blocks the first paint, and
  // its URL carries its version (`?v=`), so browsers keep it instead of
  // fetching it again on every view. vercel.json sets the same on Vercel.
  async headers() {
    return [
      {
        source: '/hydrate-after-paint.js',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ]
  },
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
