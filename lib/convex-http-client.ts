import { ConvexHttpClient } from 'convex/browser'

let convexHttpClient: ConvexHttpClient | null = null

export function getConvexHttpClient(): ConvexHttpClient {
  if (!convexHttpClient) {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL
    if (!url) {
      throw new Error('NEXT_PUBLIC_CONVEX_URL is not set')
    }
    convexHttpClient = new ConvexHttpClient(url)
  }
  return convexHttpClient
}
