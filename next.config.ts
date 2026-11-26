import type { NextConfig } from 'next'
import bundleAnalyzer from '@next/bundle-analyzer'

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
  openAnalyzer: false,
})

const nextConfig: NextConfig = {
  // Put page metadata in <head> for every client, not only Next's built-in bot
  // list, so all crawlers and link previews see article titles and tags. Pages
  // that set metadata already await the same data, so nothing is delayed.
  htmlLimitedBots: /.*/,
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
