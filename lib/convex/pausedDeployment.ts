/**
 * A paused Convex deployment refuses every function call (#609). Over HTTP it
 * answers 200 with `{"status":"error","errorMessage":"[Request ID: …] Server
 * Error\nCannot run functions while this deployment is paused. …"}`, and a
 * live subscription gets an error with the same text. The status code cannot
 * tell this from any other function error, so the text decides.
 *
 * The match is narrow: the "Server Error" line followed by the paused
 * sentence, wherever the request-id or function prefix ends. Any other
 * error, including one that merely mentions the word "paused", does not
 * match.
 */
const PAUSED_DEPLOYMENT =
  /(?:^|\] )Server Error\nCannot run functions while this deployment is paused\./

export function isPausedDeploymentMessage(message: string): boolean {
  return PAUSED_DEPLOYMENT.test(message)
}
