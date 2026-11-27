/**
 * Auth forms answer a submit made before the page scripts run.
 *
 * The browser paints the server HTML before React attaches its handlers. A
 * submit in that window would post the form natively and reload the page, so
 * the reader's tap is lost. A small inline script in the root layout catches
 * that submit, cancels it and marks the form as holding it; CSS shows the
 * pending state from the next frame. When React attaches the form
 * (`useEarlySubmit`), it sends the held submit once through the form's own
 * handler, which reads the fields as they are then.
 *
 * React sometimes renders the page again in the browser instead of attaching
 * to the server HTML. The inline script keeps a reference to the held form,
 * so the new form of the same kind takes over its values and the held submit.
 *
 * Nothing is stored or sent by the inline script: the credentials stay in the
 * form fields, in memory. If the scripts have not run after HELD_SUBMIT_MS,
 * the hold ends without sending and the reader can press again.
 */

/**
 * On an auth form, naming its kind (`login`, `register`, ...): hold a submit
 * made before React attaches the form.
 */
export const EARLY_SUBMIT_ATTRIBUTE = 'data-early-submit'
/** Set while a submit made before React attached the form is held. */
export const HELD_SUBMIT_ATTRIBUTE = 'data-held-submit'
/** Set by React when it attaches the form; its handlers take over. */
export const SCRIPTS_ACTIVE_ATTRIBUTE = 'data-scripts-active'
/** The window property that refers to the held form until React takes it. */
export const HELD_FORM_PROPERTY = '__heldSubmitForm'

export const HELD_SUBMIT_MS = 20_000

/**
 * Runs inline in `<head>`, before any form is parsed. Keep it small and
 * dependency-free.
 */
export const EARLY_SUBMIT_SCRIPT = `(function(){var h="${HELD_SUBMIT_ATTRIBUTE}",a="${SCRIPTS_ACTIVE_ATTRIBUTE}";document.addEventListener("submit",function(e){var f=e.target;if(!(f instanceof HTMLFormElement)||!f.hasAttribute("${EARLY_SUBMIT_ATTRIBUTE}")||f.hasAttribute(a))return;e.preventDefault();if(f.hasAttribute(h))return;f.setAttribute(h,"");self.${HELD_FORM_PROPERTY}=f;setTimeout(function(){if(f.hasAttribute(a))return;f.removeAttribute(h);if(self.${HELD_FORM_PROPERTY}===f)self.${HELD_FORM_PROPERTY}=null},${HELD_SUBMIT_MS})},true)})()`
