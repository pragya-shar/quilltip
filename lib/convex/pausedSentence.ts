/**
 * The sentence a paused Convex deployment answers with (#609). Shared by the
 * server's anchored match (lib/convex/pausedDeployment.ts) and the client's
 * one `includes` (hooks/convex/useReadingQuery.ts), so the client bundle
 * carries only this string.
 */
export const PAUSED_DEPLOYMENT_SENTENCE =
  'Cannot run functions while this deployment is paused.'
