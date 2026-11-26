//! TTL policy (I-25; section 8.1 "TTL"). The ledger advances past the
//! testnet minimum persistent TTL (120,960 ledgers) and past `TIP_REF_TTL`.

use quilltip_shared::{DAY, TTL_EXTEND_TO, TTL_THRESHOLD};
use soroban_sdk::testutils::{
    storage::{Instance as _, Persistent as _, Temporary as _},
    Address as _,
};
use soroban_sdk::Address;

use super::*;
use crate::storage::DataKey;
use crate::TIP_REF_TTL;

fn instance_ttl(f: &Fixture) -> u32 {
    f.e.as_contract(&f.id(), || f.e.storage().instance().get_ttl())
}

fn persistent_ttl(f: &Fixture, key: &DataKey) -> u32 {
    f.e.as_contract(&f.id(), || f.e.storage().persistent().get_ttl(key))
}

fn temporary_ttl(f: &Fixture, key: &DataKey) -> u32 {
    f.e.as_contract(&f.id(), || f.e.storage().temporary().get_ttl(key))
}

/// I-25: registration extends the instance and the article entry.
#[test]
fn registration_extends_ttl() {
    let f = Fixture::new();
    f.advance(TESTNET_MIN_PERSISTENT_TTL + 1);
    let (id, _) = f.article();
    assert!(instance_ttl(&f) >= TTL_THRESHOLD);
    assert_eq!(persistent_ttl(&f, &DataKey::Article(id)), TTL_EXTEND_TO);
}

/// I-25: a tip extends the article, the total and the instance, and writes
/// `TipRef` with `TIP_REF_TTL`.
#[test]
fn tip_extends_written_entries() {
    let f = Fixture::new();
    let (id, _) = f.article();
    let tipper = f.funded();
    // Past the testnet minimum persistent TTL and below the threshold.
    f.advance(TTL_EXTEND_TO - TTL_THRESHOLD + DAY);
    assert!(persistent_ttl(&f, &DataKey::Article(id.clone())) < TTL_THRESHOLD);

    let r = client_ref(&f.e, 1);
    f.core.tip(&tipper, &id, &f.token, &MIN_TIP, &None, &r);
    assert_eq!(
        persistent_ttl(&f, &DataKey::Article(id.clone())),
        TTL_EXTEND_TO
    );
    assert_eq!(
        persistent_ttl(&f, &DataKey::Total(id.clone(), f.token.clone())),
        TTL_EXTEND_TO
    );
    assert_eq!(instance_ttl(&f), TTL_EXTEND_TO);
    assert_eq!(
        temporary_ttl(&f, &DataKey::TipRef(tipper.clone(), r)),
        TIP_REF_TTL
    );
}

/// I-25: an article that keeps receiving tips stays live well past 120 days.
#[test]
fn tipped_article_stays_live() {
    let f = Fixture::new();
    let (id, author) = f.article();
    let tipper = f.funded();
    for n in 0..6u32 {
        f.advance(60 * DAY);
        f.core.tip(
            &tipper,
            &id,
            &f.token,
            &MIN_TIP,
            &None,
            &client_ref(&f.e, n),
        );
    }
    assert_eq!(f.core.article_author(&id), author);
    assert_eq!(f.core.article_total(&id, &f.token), 6 * MIN_TIP);
}

/// I-25: content, split and author changes extend the article entry.
#[test]
fn updates_extend_article() {
    let f = Fixture::new();
    let (id, author) = f.article();
    let key = DataKey::Article(id.clone());

    f.advance(TTL_EXTEND_TO - TTL_THRESHOLD + 1);
    f.core.update_content(&id, &hash(&f.e, 2), &None);
    assert_eq!(persistent_ttl(&f, &key), TTL_EXTEND_TO);

    f.advance(TTL_EXTEND_TO - TTL_THRESHOLD + 1);
    let co = Address::generate(&f.e);
    f.core
        .set_splits(&id, &splits(&f.e, &[author, co], &[5_000, 5_000]));
    assert_eq!(persistent_ttl(&f, &key), TTL_EXTEND_TO);

    f.advance(TTL_EXTEND_TO - TTL_THRESHOLD + 1);
    let new = Address::generate(&f.e);
    let until = f.e.ledger().sequence() + 3 * DAY;
    f.core.propose_author(&id, &new, &until);
    assert_eq!(persistent_ttl(&f, &key), TTL_EXTEND_TO);
    // The pending entry lives until `live_until_ledger`.
    assert_eq!(
        temporary_ttl(&f, &DataKey::PendingAuthor(id.clone())),
        3 * DAY
    );
    f.advance(3 * DAY);
    f.core.accept_author(&id);
    // Above the threshold, so not re-extended; I-25 requires >= TTL_THRESHOLD.
    assert!(persistent_ttl(&f, &key) >= TTL_THRESHOLD);
}

/// I-25: admin calls extend the instance.
#[test]
fn admin_calls_extend_instance() {
    let f = Fixture::new();
    f.advance(TTL_EXTEND_TO - TTL_THRESHOLD + 1);
    assert!(instance_ttl(&f) < TTL_THRESHOLD);
    f.core.set_token(&f.token, &MIN_TIP, &true);
    assert_eq!(instance_ttl(&f), TTL_EXTEND_TO);

    f.advance(TTL_EXTEND_TO - TTL_THRESHOLD + 1);
    f.core.pause(&f.pauser);
    assert_eq!(instance_ttl(&f), TTL_EXTEND_TO);

    f.advance(TTL_EXTEND_TO - TTL_THRESHOLD + 1);
    let p2 = Address::generate(&f.e);
    f.core
        .grant_role(&p2, &soroban_sdk::Symbol::new(&f.e, "pauser"), &f.admin);
    assert_eq!(instance_ttl(&f), TTL_EXTEND_TO);
}
