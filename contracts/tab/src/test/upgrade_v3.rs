//! Old state under the new code (grants). `testdata/tab_v3_2773ff1e.wasm` is
//! the Tab code deployed on testnet before grants existed (WASM hash
//! `2773ff1ef9c979a69f3977056da0a7339b600c620c9e1b44cdfd1ecc96cc207f`, read
//! from the network). The test writes state with that code, upgrades in place
//! to this crate's code through `upgrade` (no constructor, no `migrate`), and
//! checks that readers with no `Gift` entry read as zero gift and keep every
//! unit of their own money.
use super::*;
use crate::contract::ROLE_GRANTOR;
use crate::{assert_tab_err, TabError};
use quilltip_shared::DAY;

const V3_WASM: &[u8] = include_bytes!("../../testdata/tab_v3_2773ff1e.wasm");

#[test]
fn v3_state_reads_as_no_gift_after_an_in_place_upgrade() {
    let f = Fixture::with_code(
        Env::new_with_config(EnvTestConfig {
            capture_snapshot_at_drop: false,
        }),
        Some(V3_WASM),
    );
    // State written by the v3 code.
    let writer = Address::generate(&f.e);
    let (spender, key, key_id) = f.reader(10 * XLM, 5 * XLM);
    f.settle(&vec1(
        &f.e,
        f.voucher(&spender, &writer, key_id, &key, 2 * XLM),
    ));
    let (leaving, _, _) = f.reader(4 * XLM, XLM);
    f.withdraw_start(&leaving);
    let keyed = Address::generate(&f.e);
    let kk = signing_key("v3-keyed");
    let kid = f.open_session(&keyed, 0, &kk, f.now() + 7 * DAY, XLM);
    let cfg_before = f.client().config();

    // In-place upgrade to this crate's code.
    let hash = f.e.upload(QuillTipTab);
    f.auth(
        &f.upgrader,
        "upgrade",
        (hash.clone(), f.upgrader.clone()).into_val(&f.e),
    );
    f.client().upgrade(&hash, &f.upgrader);
    assert_eq!(f.client().config(), cfg_before);

    // No `Gift` entry reads as zero, and no old key is a granted key.
    for r in [&spender, &leaving, &keyed] {
        assert_eq!(f.client().gift(r), 0);
    }
    assert!(!f.client().is_granted_key(&spender, &key_id));
    assert!(!f.client().is_granted_key(&keyed, &kid));
    // The old key keeps spending the reader's own money as before.
    let s = f.settle(&vec1(
        &f.e,
        f.voucher(&spender, &writer, key_id, &key, 3 * XLM),
    ));
    assert_eq!(s.gross, XLM);
    assert_eq!(f.client().account(&spender).unwrap().balance, 7 * XLM);
    // A withdrawal started under v3 pays the whole balance.
    f.advance(crate::WITHDRAW_DELAY);
    assert_eq!(f.withdraw(&leaving), 4 * XLM);
    // A new withdrawal pays every unit of own money.
    f.withdraw_start(&spender);
    f.advance(crate::WITHDRAW_DELAY);
    assert_eq!(f.withdraw(&spender), 7 * XLM);

    // Grants on the upgraded contract.
    let funder = Address::generate(&f.e);
    f.mint(&funder, MAX_BALANCE);
    f.auth(
        &f.admin,
        "grant_role",
        (funder.clone(), ROLE_GRANTOR, f.admin.clone()).into_val(&f.e),
    );
    f.client().grant_role(&funder, &ROLE_GRANTOR, &f.admin);
    // Not onto a reader with a v3 key.
    let pk = public_key(&f.e, &signing_key("v3-new"));
    let until = f.now() + 7 * DAY;
    let args = (
        funder.clone(),
        keyed.clone(),
        5 * XLM,
        pk.clone(),
        until,
        5 * XLM,
    );
    f.auth_with_transfer(&funder, "grant_session", args.into_val(&f.e), 5 * XLM);
    assert_tab_err!(
        f.client()
            .try_grant_session(&funder, &keyed, &(5 * XLM), &pk, &until, &(5 * XLM)),
        TabError::GrantAccountInUse
    );
    // Onto a new reader.
    let fresh = Address::generate(&f.e);
    let args = (
        funder.clone(),
        fresh.clone(),
        5 * XLM,
        pk.clone(),
        until,
        5 * XLM,
    );
    f.auth_with_transfer(&funder, "grant_session", args.into_val(&f.e), 5 * XLM);
    let gid = f
        .client()
        .grant_session(&funder, &fresh, &(5 * XLM), &pk, &until, &(5 * XLM));
    assert!(f.client().is_granted_key(&fresh, &gid));
    assert_eq!(f.client().gift(&fresh), 5 * XLM);
}
