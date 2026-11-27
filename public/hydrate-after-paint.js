// Starts the page's Next.js chunk scripts after the first contentful paint, so
// they neither delay nor compete with it (scripts/next/hydrate-after-paint.ts,
// docs/performance/page-load.md). Next.js lists the root chunks in this
// script's URL and writes the other chunk scripts inert, as
// <script type="text/plain" data-hydrate-after-paint="...">. Both are added as
// real scripts in the order Next.js would have added them.
;(function () {
  var self = document.currentScript
  if (!self) return
  var nonce = self.nonce
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
    if (self.crossOrigin) script.crossOrigin = self.crossOrigin
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
    try {
      new MutationObserver(addInert).observe(document.documentElement, {
        childList: true,
        subtree: true,
      })
    } catch {
      setTimeout(addInert, 1000)
    }
  }

  // The paint entry is reported once the first content is on screen.
  try {
    var observer = new PerformanceObserver(function (entries) {
      if (entries.getEntriesByName('first-contentful-paint').length) {
        observer.disconnect()
        setTimeout(start, 0)
      }
    })
    observer.observe({ type: 'paint', buffered: true })
  } catch {
    start()
    return
  }
  // A press on a button that needs JavaScript before the page has hydrated
  // is held and replayed on the same button once React handles it. Links
  // keep their default behaviour, which works without JavaScript.
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
      target && target.closest
        ? target.closest('button[type="button"], [role="button"]')
        : null
    if (!button || hydrated(button)) return
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
        form.requestSubmit(submitter && submitter.form === form ? submitter : undefined)
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

  // A reader who interacts first, a tab that never paints in the background
  // and browsers without paint timing still load the page.
  var events = ['pointerdown', 'keydown', 'touchstart']
  for (var j = 0; j < events.length; j++)
    addEventListener(events[j], start, { once: true, passive: true, capture: true })
  if (document.visibilityState === 'hidden') start()
  setTimeout(start, 3000)
})()
