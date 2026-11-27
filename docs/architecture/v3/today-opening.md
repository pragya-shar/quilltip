# Today: which article opens it

Today (`/`) opens on one article, already underway: its title, byline, first paragraphs, Read more and the time left. The server chooses it with `today.opening` (`convex/today.ts`); the rule is in `convex/lib/todayOpening.ts`.

## Requirements

- **Deterministic for a day.** For a given UTC day and skip list, the server render and a reader with no script see the same article.
- **Only real, public writing.** Never a draft or an unpublished article, and never an article without a body.
- **Fair to writers without tips.**
- **Cheap.** One bounded indexed read per call, and no scan.
- **No repeats for a returning reader.** A reader does not get an article they already opened or finished.

## The rule now

1. **Window.** One UTC day. The opening is the same for everyone that day.
2. **Candidates.** One indexed read (`articles.by_published_date`) gets the newest 60 published articles that were published before the day began. If none qualify, as in a brand-new catalogue, a second read takes articles published up to now.
3. **Filter.** Each writer keeps only their newest article. Each article must have a real title and at least 60 words of paragraph text. Headings, lists, images and embeds do not count toward the 60 words.
4. **Order (`compareForWindow`).** Each candidate gets the FNV-1a hash of `day:articleId`. The lowest hash opens Today, and the next four are "More today". This is rendezvous hashing, so publishing or removing one article changes the opening only when that article wins.
5. **Tips play no part.** Every writer opens Today in turn, tipped or not. The article tip counters are not written by every tip path yet, and ranking by tips would starve new writers.
6. **Skip list.** The page sends the `qt_finished` cookie: up to 20 ids of articles this browser finished, written by the article view. Those articles move to the back of the order. If a reader finished every candidate, an article still opens.
7. **Time left.** The words after the shown paragraphs, at 230 words a minute, rounded up (`minutesLeft`).

## What the server knows without scripts

The server render sees only the cookie, so it can skip only articles that were **finished** in this browser. It cannot know articles that were opened but not finished. Those live in the browser's reading-place list, and the "Your place" row above the opening offers the newest of them. With scripts off, the cookie is never written, so nothing is skipped. A signed-in reader on another device is not skipped either, until reading positions are stored on the server.

## The target rule (from the design; D22)

When finishes and keeps are recorded per article, only step 4 changes:

- **Order.** By finishes plus keeps in the last 7 days, highest first; ties go to more tips, then to the newer article, then to the lower id.
- **Skip.** A returning reader also skips every article they opened, read from server-side reading positions.

Steps 1 to 3, the skip list and the time left stay as they are. The order is one function, `compareForWindow`, and the query reads no other signal. Moving to the target rule means a signals table read by that function, plus a test that every writer still gets turns.

## Rejected

- **Most tipped in 7 days** (the design's reduced rule): the tip counters are incomplete, and the rule would starve new writers.
- **A six-hour window:** replaced by one day, so the place called Today means the same thing for everyone that day.
- **A random article per request:** the server render and a reader with no script would see different pages, and no cache could hold the answer.

## Caching

The page reuses an answer for 60 seconds, keyed by the minute and the skip list. An unpublished article therefore leaves Today within 60 seconds. A newly published article joins the candidates on the next UTC day. A read that fails, or takes longer than 1.5 s (D21), is never stored.
