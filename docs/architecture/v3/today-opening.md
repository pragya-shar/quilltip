# Today: which article opens it

Today (`/`) opens on one article, already underway: its title, byline, first paragraphs, Read more and the time left. The server chooses it with `today.opening` (`convex/today.ts`), and the rule is in `convex/lib/todayOpening.ts`.

## Requirements

- **Deterministic.** For a given moment and skip list, the server render and a reader with no script see the same article. Once an article from before the hour exists, the opening is the same for the whole hour.
- **Never falsely empty.** Today says there is nothing to read only when no eligible article is published.
- **Only real, public writing.** Never a draft or an unpublished article, and never an article without a body.
- **Tips play no part.** A writer without tips opens Today as often as one with many.
- **Bounded cost.** Reads are indexed and capped at 200 article documents per call; nothing scans the table.
- **No repeats for a returning reader.** A reader does not get an article they already opened or finished in this browser.

## The rule now: an hourly rotation among the most recent writers

1. **Window.** One UTC hour. The opening changes once per UTC hour and is the same for everyone that hour, except in an hour with no older article, when the newest article opens Today.
2. **Candidates.** Articles published before the hour began, read newest first from `articles.by_published_date` in pages of 50.
   - Reading stops once enough distinct writers are eligible (1 for the opening, 12 for the list, plus up to 20 for skipped articles), or after 4 pages (200 articles).
   - When that read finds too few writers, the hour's own articles follow, published up to the moment rendered, newest first, one per writer not found yet. Both reads share the 4 pages. So a catalogue whose every article is from the current hour opens on its newest article, and Today says there is nothing to read only when no eligible article is published.
   - When more than 50 articles share one publish time, the next page starts just before that time, so the read never stalls.
3. **Filter.** Each writer keeps only their newest eligible article. Eligible means a real title and at least two body paragraphs (top-level paragraphs and paragraphs in quotes).
4. **Order (`compareForWindow`).** Each candidate from before the hour gets the FNV-1a hash of `hour:articleId`. The lowest hash opens Today, and the next twelve are "More to read". The hour's own articles come after them, newest first, so the opening holds for the hour once an older article exists. This is rendezvous hashing, so publishing or removing one article changes the opening only when that article wins.
5. **Who rotates.** The rotation covers the writers with the most recent eligible articles: the first 13 or so found by step 2. A writer whose newest article is older than all of those is not a candidate that hour, until fewer recent writers publish. Tips play no part: the article tip counters are not written by every tip path yet, and ranking by tips would starve new writers.
6. **Skip list.** The page sends the ids from two cookies the article view writes, `qt_finished` and `qt_opened`. Each cookie is validated: Convex ids only, at most 20 each, and anything else is ignored. Those articles move to the back of the order. If a reader skipped every candidate, an article still opens.
7. **The opening.** Whole paragraphs from the start, up to 90 words and never more. When that shows fewer than 40 words (a short first paragraph, or a first paragraph longer than the opening), the next paragraph is added, cut at a sentence within the 90 words. The opening is therefore never one short line under the fade. At 390 px with a title of two or three lines, the text, its fade and **Read more** fit on the first screen, above the bar. A height limit in CSS would hide text that Read more then skips, so the word limit sets the length.
8. **Read more.** It links to the article view's paragraph anchor (`#s-{p}-0`) for the paragraph where the opening stopped, so reading continues there. A whole article links to itself.
9. **Time left.** The words after what is shown, at 230 words a minute, rounded up (`minutesLeft`).

## What the server knows without scripts

The server render sees only the two cookies. Opened and finished articles are skipped in the browser that read them, once the article view has written the cookies. With scripts off, nothing is written, so nothing is skipped. A signed-in reader on another device is not skipped either, until reading positions are stored on the server.

## The target rule

When finishes and keeps are recorded per article, step 4 changes, and step 2 can widen:

- **Order.** By finishes plus keeps in the last 7 days, highest first. Ties go to more tips, then to the newer article, then to the lower id.
- **Skip.** For a signed-in reader, opened articles are also read from server-side reading positions.
- **A stored hourly opening.** Computed once per hour by the backend, it removes the per-request read and lets the rotation cover every writer.

Every other step stays as it is. The order is one function, `compareForWindow`, and the query reads no other signal.

## Rejected

- **Most tipped in 7 days:** the tip counters are incomplete, and the rule would starve new writers.
- **A daily window:** the opening held all day, but a new catalogue, or a day of new writing, waited for the next UTC day. One hour keeps Today current, and the opening is still the same for everyone in that hour.
- **A random article per request:** the server render and a reader with no script would see different pages, and no cache could hold the answer.

## Caching and limits

- **The cache.** The answer for a reader with no skip list is reused for 60 seconds, keyed by the minute. An unpublished article therefore leaves Today within 60 seconds. The key stays the minute because the hour's own articles are read up to the moment rendered: a newly published article shows within a minute when the list has room, or opens Today when nothing older exists, and joins the hour's order at the next UTC hour.
- **Skip lists.** A reader with a skip list gets a direct read, so no cookie value creates a cache entry. That read is bounded like any other.
- **The time limit.** Every read has a 1.5 s limit. A read that fails or runs out of time renders the unavailable state and is never stored.
