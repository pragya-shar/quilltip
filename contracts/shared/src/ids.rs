//! Identifier types (`01-architecture.md`, section 1.4).
//!
//! Every identifier on chain is fixed-size bytes. Convex and the client derive
//! them with the same rules; `test-vectors.json` fixes the expected values.

use soroban_sdk::{Address, Bytes, BytesN, Env};

use crate::constants::{ARTICLE_ID_PREFIX, ARTICLE_REF_PREFIX};

/// `SHA-256(UTF-8("quilltip:article:v1:" + <Convex articles _id>))`.
pub type ArticleId = BytesN<32>;

/// The app's reference to an article, 32 bytes (see [`article_ref`]).
pub type ArticleRef = BytesN<32>;

/// Full SHA-256 of `"{slug}:{start}:{end}:{text[0..50]}"`. Optional where used.
pub type HighlightId = BytesN<32>;

/// SHA-256 of the canonical article bytes.
pub type ContentHash = BytesN<32>;

/// base64url-decoded Arweave transaction ID. Optional where used.
pub type ArweaveId = BytesN<32>;

/// 16 random bytes per payment intent (the idempotency key).
pub type ClientRef = BytesN<16>;

/// Merkle root of tab receipts.
pub type ReceiptsRoot = BytesN<32>;

/// Returns `true` when every byte is zero.
///
/// The zero value is invalid for `article_id`, `content_hash` and `arweave_id`;
/// contracts reject it with their `InvalidHash` error.
pub fn is_zero<const N: usize>(value: &BytesN<N>) -> bool {
    value.iter().all(|b| b == 0)
}

/// Derives an `article_ref` from the UTF-8 bytes of a Convex `articles` `_id`:
/// `sha256("quilltip:article:v1:" || convex_id)`.
pub fn article_ref(e: &Env, convex_article_id: &Bytes) -> ArticleRef {
    let mut preimage = Bytes::from_slice(e, ARTICLE_REF_PREFIX.as_bytes());
    preimage.append(convex_article_id);
    e.crypto().sha256(&preimage).to_bytes()
}

/// Derives the `article_id` that Core stores for `author` and `article_ref`:
/// `sha256("quilltip:article:v2:" || author_strkey || article_ref)`, where
/// `author_strkey` is the 56-character G or C address in UTF-8.
///
/// Only `author` can register this ID, so no other account can claim an
/// article's ID before its author does.
pub fn article_id(e: &Env, author: &Address, article_ref: &ArticleRef) -> ArticleId {
    let mut preimage = Bytes::from_slice(e, ARTICLE_ID_PREFIX.as_bytes());
    preimage.append(&author.to_string().to_bytes());
    preimage.append(&Bytes::from(article_ref.clone()));
    e.crypto().sha256(&preimage).to_bytes()
}

/// Derives a `highlight_id` from the UTF-8 bytes of the v1 highlight string
/// `"{slug}:{start}:{end}:{text[0..50]}"`.
///
/// The 28-hex-character v1 Convex ID is the first 14 bytes of this digest.
pub fn highlight_id(e: &Env, highlight_source: &Bytes) -> HighlightId {
    e.crypto().sha256(highlight_source).to_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zero_detection() {
        let e = Env::default();
        assert!(is_zero(&BytesN::<32>::from_array(&e, &[0; 32])));
        let mut one = [0u8; 32];
        one[31] = 1;
        assert!(!is_zero(&BytesN::<32>::from_array(&e, &one)));
        assert!(is_zero(&BytesN::<16>::from_array(&e, &[0; 16])));
    }
}
