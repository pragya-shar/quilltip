import { buildIconSprite } from '@/system/iconSprite'

// The icon sprite (system/iconSprite.ts), built once at build time. Its
// address carries its hash, so it is cached for good.
export const dynamic = 'force-static'

export function GET() {
  return new Response(buildIconSprite(), {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
