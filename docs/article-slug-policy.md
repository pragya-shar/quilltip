# Article slug policy

Public articles are addressed as `/{username}/{slug}`. The slug is derived from the title (lowercase, non-alphanumeric to hyphens, max 100 characters). If slugification yields an empty string, the backend uses `article-{timestamp}`. The same author cannot reuse a slug on another article; on collision, a `-{timestamp}` suffix is appended.

## Unpublished drafts

Whenever the title changes on save (`saveDraft` with an existing id) or via `updateArticle`, the slug is recomputed from the **current** title. The author’s **current** document is excluded from uniqueness checks so updating a draft does not block its own new slug.

This keeps in-progress URLs aligned with the visible title (for example after replacing the default “Untitled” with a real title).

## Published articles

After publish, the slug is **frozen**. Editing the title through `updateArticle` updates the title only; the slug does not change. This avoids breaking bookmarks, shared links, and metadata (for example NFT `external_url`) that incorporate the slug.

## First publish and placeholder slugs

If the row still has a **placeholder** slug at publish time, it is replaced once using the current title and the same uniqueness rules (still excluding the publishing row). Placeholder patterns:

- `untitled`
- `untitled-{digits}` (for example collision suffix on the default title)
- `article-{10+ digits}` (empty slugify fallback using a millisecond timestamp)

Titles such as “Article 42” (slug `article-42`) are **not** treated as placeholders, so short numeric segments do not trigger a silent rewrite.

## Out of scope

- Bulk rewriting historical slugs in production without redirects or comms.
- Changing the username segment of the URL scheme.
- Automatic HTTP redirects from arbitrary old slugs unless product adds that layer explicitly.

## Arweave

Permanent upload payloads use title, body, and author fields; they do not embed the slug. Slug changes remain primarily a web URL and linking concern.
