import { PAUSED_DEPLOYMENT_SENTENCE } from '@/lib/convex/pausedSentence'

/**
 * A paused Convex deployment refuses every function call (#609). Over HTTP it
 * answers 200 with `{"status":"error","errorMessage":"[Request ID: …] Server
 * Error\nCannot run functions while this deployment is paused. …"}`, and a
 * live subscription gets an error with the same text. The status code cannot
 * tell this from any other function error, so the text decides.
 *
 * The server's match is narrow: the "Server Error" line followed by the
 * paused sentence, wherever the request-id or function prefix ends. Any
 * other error, including one that merely mentions the word "paused", does
 * not match. (The client checks only the sentence, to stay small.)
 */
const PAUSED_DEPLOYMENT = new RegExp(
  `(?:^|\\] )Server Error\\n${PAUSED_DEPLOYMENT_SENTENCE.replace(/[.]/g, '\\.')}`
)

export function isPausedDeploymentMessage(message: string): boolean {
  return PAUSED_DEPLOYMENT.test(message)
}
