/**
 * What the shell knows before the first paint, from the browser alone, set
 * on <html> by one small script (with the CSP nonce) in the root layout:
 * - `data-theme`: a light or dark choice stored by the legacy pages
 *   (next-themes, key "theme"), so crossing never flashes the other theme;
 * - `data-session="held"`: this browser holds a Convex Auth token, so the
 *   balance item shows the neutral "Balance" instead of "Sign in" until the
 *   amount arrives (no flash, no width change). With no script, nobody can
 *   be signed in, and "Sign in" is a plain link.
 * `hasAuthToken` is the same test for code that runs later (Today's rows).
 */

/** Convex Auth keeps its token under keys that start with this. */
export const AUTH_TOKEN_PREFIX = '__convexAuthJWT'

/** The attribute on <html> that says a session token is held. */
export const SESSION_ATTR = 'data-session'

/** Whether this browser holds a session token (signed in, or was). */
export function hasAuthToken(
  storage: Pick<Storage, 'key' | 'length'>
): boolean {
  try {
    for (let i = 0; i < storage.length; i++) {
      if (storage.key(i)?.startsWith(AUTH_TOKEN_PREFIX)) return true
    }
  } catch {
    // Storage blocked: treat as signed out.
  }
  return false
}

/**
 * The pre-paint script, plain ES5, never throws. It also settles the
 * cross-document view transition (shell/shell.css `@view-transition`): a
 * quick full reload aborts it, and its promises would reject unhandled
 * ("Transition was aborted"). Registered here because `pagereveal` fires
 * before the first render.
 */
export const PRE_PAINT_SCRIPT = [
  'try{',
  'var q=function(e){var v=e&&e.viewTransition;if(!v)return;',
  'var n=function(){};',
  'for(var p=["ready","finished","updateCallbackDone"],j=0;j<p.length;j++)',
  'if(v[p[j]]&&v[p[j]].catch)v[p[j]].catch(n)};',
  'addEventListener("pagereveal",q);addEventListener("pageswap",q);',
  '}catch(e){}',
  'try{',
  'var d=document.documentElement,s=localStorage,t=s.getItem("theme");',
  'if(t==="light"||t==="dark")d.dataset.theme=t;',
  'for(var i=0;i<s.length;i++){var k=s.key(i);',
  `if(k&&k.indexOf("${AUTH_TOKEN_PREFIX}")===0){d.setAttribute("${SESSION_ATTR}","held");break}}`,
  '}catch(e){}',
].join('')
