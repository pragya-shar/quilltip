# Today: which article opens it

Today (`/`) opens on one article, already underway: its title, byline, first paragraphs and Read more. The server chooses it with `today.opening` (`convex/today.ts`); the rule is in `convex/lib/todayOpening.ts`.

## Requirements

- **Deterministic for a moment.** The server render and a reader with no script see the same article.
- **Only real, public writing.** Never a draft or an unpublished article, and never an article without a body.
- **Fair to writers without tips.** Tips do not decide the opening.
- **Cheap.** One bounded indexed read per call, and no scan.
- **No repeats for a returning reader.** A reader does not get an article they already finished.

## The rule

1. **Windows.** Time is cut into six-hour windows: 00:00, 06:00, 12:00 and 18:00 UTC. The opening holds for the whole window.
2. **Candidates.** One indexed read (`articles.by_published_date`) gets the newest 60 published articles that were published before the window began. If none qualify, as in a brand-new catalogue, a second read takes articles published up to now.
3. **Filter.** Each writer keeps only their newest article. Each article must have a real title and at least 60 words of paragraph text. Headings, lists, images and embeds do not count toward the 60 words.
4. **Order.** Each candidate gets a score: the FNV-1a hash of `window:articleId`. The lowest score opens Today, and the next four are "More today". This is rendezvous hashing, so publishing or removing one article changes the opening only when that article wins.
5. **Tips play no part.** Every writer opens Today equally often, tipped or not. Paid lines reach Today through the mix, a later package. They never reach it through the opening.
6. **Finished articles.** The page sends up to 20 ids of articles this browser finished, from the `qt_finished` cookie. They move to the back of the order. If a reader finished every candidate, an article still opens.

## Rejected

- **Most tipped first.** It starves new writers. The article tip counters do not yet count every kind of tip.
- **One opening per day.** With 14 writers, each would open Today about once a fortnight.
- **A random article per request.** The server render and a reader with no script would see different pages, and no cache could hold the answer.

## Later

When finishes and keeps are recorded per article, they become a weight in step 4. They will weight the order but never filter it, so new writers still get turns. Server-side reading positions will replace the cookie as the skip list for signed-in readers.
