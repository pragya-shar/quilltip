// What a paused Convex deployment answers (#609), for the unit tests and the
// fixture backend. Measured on a paused hosted deployment: POST /api/query
// answers HTTP 200, application/json, no Retry-After, with PAUSED_BODY, for a
// missing and an existing function alike.

/** Measured on a paused hosted deployment: HTTP 200 with this body. */
export const PAUSED_BODY = {
  status: 'error',
  errorMessage:
    '[Request ID: 3f2c9a71d1b84e6a] Server Error\nCannot run functions while this deployment is paused. Resume the deployment in the dashboard settings to allow functions to run.\n',
}
/** The same shape and status with another message: an ordinary error. */
export const NEAR_MISS_BODY = {
  status: 'error',
  errorMessage:
    '[Request ID: 3f2c9a71d1b84e6a] Server Error\nUncaught Error: the reading list is paused for maintenance\n',
}
