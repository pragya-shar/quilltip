// Starts the page's Next.js chunk scripts after the first contentful paint, so
// they neither delay nor compete with it. Next.js (patched by
// patches/next@16.4.6.ts) lists the root chunks in this script's URL and
// writes the other chunk scripts inert, as
// <script type="text/plain" data-hydrate-after-paint="...">. This script adds
// them as real async scripts, in the order Next.js wrote them.
// See docs/performance/next-patch.md.
;(function () {
  var self = document.currentScript
  if (!self) return
  var nonce = self.nonce
  var crossOrigin = self.crossOrigin
  var list = new URL(self.src).searchParams.get('c')
  var queued = list ? list.split(' ') : []
  var added = {}
  var started = false

  function add(src) {
    if (!src || added[src]) return
    added[src] = true
    var script = document.createElement('script')
    script.src = src
    script.async = true
    if (nonce) script.nonce = nonce
    if (crossOrigin) script.crossOrigin = crossOrigin
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

  // A press on a button that needs JavaScript before the page has hydrated
  // is held, starts the scripts at once, and is replayed on the same button
  // once React handles it. Links keep their default behaviour, which works
  // without JavaScript; a form's own submit is held below.
  function hydrated(element) {
    for (var key in element) if (key.indexOf('__reactProps') === 0) return true
    return false
  }
  function replayWhenReady(element, tries) {
    if (hydrated(element)) {
      element.click()
      return
    }
    if (tries > 0) setTimeout(replayWhenReady, 50, element, tries - 1)
  }
  function holdPress(event) {
    if (hydrated(document.body)) {
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
    replayWhenReady(button, 200)
  }
  addEventListener('click', holdPress, true)

  // A form sent before hydration is held the same way and sent again once
  // React handles it, with the same submit button.
  function resubmitWhenReady(form, submitter, tries) {
    if (hydrated(form)) {
      if (typeof form.requestSubmit === 'function')
        form.requestSubmit(
          submitter && submitter.form === form ? submitter : undefined
        )
      else form.submit()
      return
    }
    if (tries > 0) setTimeout(resubmitWhenReady, 50, form, submitter, tries - 1)
  }
  function holdSubmit(event) {
    if (hydrated(document.body)) {
      removeEventListener('submit', holdSubmit, true)
      return
    }
    var form = event.target
    if (!form || hydrated(form)) return
    event.preventDefault()
    event.stopPropagation()
    start()
    resubmitWhenReady(form, event.submitter, 200)
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
