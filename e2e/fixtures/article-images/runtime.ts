// Browser-only stand-ins for Convex in the article image fixture. The
// readers and the writing editor need no data; nothing is sent anywhere.
export const useConvex = () => ({})
export const useMutation = () => async () => null
export const useQuery = () => undefined
export class ConvexReactClient {}
export const api = new Proxy(
  {},
  { get: () => new Proxy({}, { get: () => ({}) }) }
)
