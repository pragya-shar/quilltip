// Starts the page's Next.js chunk scripts after the first contentful paint, so
// they neither delay nor compete with it. Next.js (patched by
// patches/next@16.4.6.ts) lists the root chunks in this script's URL and
// writes the other chunk scripts inert, as
// <script type="text/plain" data-hydrate-after-paint="...">. This script adds
// them as real async scripts, in the order Next.js wrote them.
// See docs/performance/next-patch.md.
;(function () {
  // Next.js writes this script twice: in <head> without async, so it runs
  // before the first paint and holds early presses, and as the bootstrap
  // script at the end of the HTML. The second run does nothing.
  if (window.__quilltipHydrateAfterPaint) return
  window.__quilltipHydrateAfterPaint = true
  var self = document.currentScript
  if (!self) return
  var nonce = self.nonce
  var crossOrigin = self.crossOrigin
  var list = new URL(self.src).searchParams.get('c')
  var queued = list ? list.split(' ') : []
  var added = {}
  var started = false

  // Chunk scripts added and not yet loaded, and when the last one finished.
  var pending = 0
  var settledAt = 0

  function finished() {
    pending--
    if (pending === 0) settledAt = Date.now()
  }

  function add(src) {
    if (!src || added[src]) return
    added[src] = true
    pending++
    settledAt = 0
    var script = document.createElement('script')
    script.src = src
    script.async = true
    if (nonce) script.nonce = nonce
    if (crossOrigin) script.crossOrigin = crossOrigin
    script.onload = finished
    script.onerror = finished
    document.head.appendChild(script)
  }

  function addInert() {
    var inert = document.querySelectorAll('script[data-hydrate-after-paint]')
    for (var i = 0; i < inert.length; i++)
      add(inert[i].getAttribute('data-hydrate-after-paint'))
  }

  function start() {
    if (started) return
    started = true
    for (var i = 0; i < queued.length; i++) add(queued[i])
    addInert()
    // Chunk scripts of parts of the page that stream in later.
    if (typeof MutationObserver === 'function')
      new MutationObserver(addInert).observe(document.documentElement, {
        childList: true,
        subtree: true,
      })
    else setInterval(addInert, 250)
  }

  // A press on a button that needs JavaScript before React handles it is
  // held, starts the scripts at once, and is replayed on the same button once
  // React has hydrated that button. Links keep their default behaviour, which
  // works without JavaScript; a form's own submit is held below.
  //
  // React hydrates parts of the page at different times (the body before
  // content that loads later), so each element is checked on its own. An
  // element React does not render never gets its props: 5 s after the last
  // chunk script has loaded, or 30 s after the press, the press goes through.
  function hydrated(element) {
    for (var key in element) if (key.indexOf('__reactProps') === 0) return true
    return false
  }
  function settled() {
    return settledAt !== 0 && Date.now() - settledAt > 5000
  }
  function whenReady(element, action, deadline) {
    if (hydrated(element) || settled() || Date.now() > deadline) action()
    else setTimeout(whenReady, 50, element, action, deadline)
  }
  function holdPress(event) {
    if (settled()) {
      removeEventListener('click', holdPress, true)
      return
    }
    var target = event.target
    var button =
      target && target.closest ? target.closest('button, [role="button"]') : null
    if (!button || hydrated(button)) return
    // A submit or reset button in a form acts without JavaScript; its submit
    // event is held instead.
    if (button.tagName === 'BUTTON' && button.form && button.type !== 'button')
      return
    event.preventDefault()
    event.stopPropagation()
    start()
    whenReady(
      button,
      function () {
        removeEventListener('click', holdPress, true)
        button.click()
        addEventListener('click', holdPress, true)
      },
      Date.now() + 30000
    )
  }
  addEventListener('click', holdPress, true)

  // A form sent before React handles it is held the same way and sent again,
  // with the same submit button.
  function holdSubmit(event) {
    if (settled()) {
      removeEventListener('submit', holdSubmit, true)
      return
    }
    var form = event.target
    if (!form || hydrated(form)) return
    event.preventDefault()
    event.stopPropagation()
    start()
    var submitter = event.submitter
    whenReady(
      form,
      function () {
        removeEventListener('submit', holdSubmit, true)
        if (typeof form.requestSubmit === 'function')
          form.requestSubmit(
            submitter && submitter.form === form ? submitter : undefined
          )
        else form.submit()
        addEventListener('submit', holdSubmit, true)
      },
      Date.now() + 30000
    )
  }
  addEventListener('submit', holdSubmit, true)

  // When to start. Normally on the first contentful paint. Every other case
  // starts within a short, fixed bound:
  // - a prerendered or hidden page paints nothing to wait for: at once;
  // - a page restored from the back/forward cache: at once;
  // - a browser without paint timing (or a blocked PerformanceObserver):
  //   after the first frame;
  // - the reader presses or types first: at once;
  // - anything else: after 3 s.
  function startAfterFrame() {
    if (typeof requestAnimationFrame === 'function')
      requestAnimationFrame(function () {
        setTimeout(start, 0)
      })
    else setTimeout(start, 0)
  }
  var paintTiming = false
  try {
    paintTiming =
      typeof PerformanceObserver === 'function' &&
      (PerformanceObserver.supportedEntryTypes || []).indexOf('paint') !== -1
  } catch {
    paintTiming = false
  }
  if (document.prerendering || document.visibilityState === 'hidden') start()
  else if (paintTiming) {
    try {
      var observer = new PerformanceObserver(function (entries) {
        if (entries.getEntriesByName('first-contentful-paint').length) {
          observer.disconnect()
          setTimeout(start, 0)
        }
      })
      observer.observe({ type: 'paint', buffered: true })
    } catch {
      startAfterFrame()
    }
  } else startAfterFrame()

  addEventListener('pageshow', function (event) {
    if (event.persisted) start()
  })
  addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') start()
  })
  var events = ['pointerdown', 'keydown', 'touchstart']
  for (var j = 0; j < events.length; j++)
    addEventListener(events[j], start, {
      once: true,
      passive: true,
      capture: true,
    })
  setTimeout(start, 3000)
})()
