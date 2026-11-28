//! Edge cases: reader authorisation for key changes, strict signature checks,
//! signatures in the wrong role, and partial acceptance fields. Fixtures here
//! write no snapshots.
use super::*;
use crate::events::VoucherSkipped;
use crate::SKIP_NOT_ACCEPTED;
use quilltip_shared::fee::fee;
use quilltip_shared::DAY;
use soroban_sdk::Event as _;

/// The ed25519 group order L, little-endian.
const GROUP_ORDER: [u8; 32] = [
    0xed, 0xd3, 0xf5, 0x5c, 0x1a, 0x63, 0x12, 0x58, 0xd6, 0x9c, 0xf7, 0xa2, 0xde, 0xf9, 0xde, 0x14,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10,
];

fn with_signature(v: &Voucher, f: &Fixture, sig: [u8; 64]) -> Voucher {
    let mut out = v.clone();
    out.signature = BytesN::from_array(&f.e, &sig);
    out
}

#[test]
fn register_key_needs_reader_auth() {
    // I-26: only the reader can add a key to its account.
    let f = Fixture::quiet();
    let reader = Address::generate(&f.e);
    let stranger = Address::generate(&f.e);
    let pk = public_key(&f.e, &signing_key("unauthorised-key"));
    let until = f.now() + DAY;
    let args = || (reader.clone(), pk.clone(), until, XLM).into_val(&f.e);
    assert!(f
        .client()
        .try_register_key(&reader, &pk, &until, &XLM)
        .is_err());
    f.auth(&stranger, "register_key", args());
    assert!(f
        .client()
        .try_register_key(&reader, &pk, &until, &XLM)
        .is_err());
    assert!(f.client().account(&reader).is_none());
    assert!(f.client().session_key(&reader, &0).is_none());
    f.auth(&reader, "register_key", args());
    assert_eq!(f.client().register_key(&reader, &pk, &until, &XLM), 0);
}

#[test]
fn revoke_key_needs_reader_auth() {
    let f = Fixture::quiet();
    let (reader, _, key_id) = f.reader(10 * XLM, 10 * XLM);
    let stranger = Address::generate(&f.e);
    let before = f.client().session_key(&reader, &key_id).unwrap();
    f.auth(
        &stranger,
        "revoke_key",
        (reader.clone(), key_id).into_val(&f.e),
    );
    assert!(f.client().try_revoke_key(&reader, &key_id).is_err());
    assert_eq!(f.client().session_key(&reader, &key_id).unwrap(), before);
}

#[test]
fn small_order_session_key_cannot_forge_vouchers() {
    // I-14: the identity point verifies R = identity, S = 0 for every message under a
    // permissive check. The contract registers such a key but must never settle with it.
    let mut identity = [0u8; 32];
    identity[0] = 1;
    let mut forged = [0u8; 64];
    forged[0] = 1;
    let permissive = ed25519_dalek::VerifyingKey::from_bytes(&identity).unwrap();
    let sig = ed25519_dalek::Signature::from_bytes(&forged);
    use ed25519_dalek::Verifier;
    assert!(permissive.verify(b"any message", &sig).is_ok());
    assert!(permissive.verify_strict(b"any message", &sig).is_err());

    let f = Fixture::quiet();
    let reader = Address::generate(&f.e);
    f.mint(&reader, MAX_BALANCE);
    let pk = BytesN::from_array(&f.e, &identity);
    let until = f.now() + DAY;
    let amount = 10 * XLM;
    f.auth_with_transfer(
        &reader,
        "open_session",
        (reader.clone(), amount, pk.clone(), until, amount).into_val(&f.e),
        amount,
    );
    let key_id = f
        .client()
        .open_session(&reader, &amount, &pk, &until, &amount);
    let w = Address::generate(&f.e);
    let v = Voucher {
        reader: reader.clone(),
        writer: w.clone(),
        key_id,
        cumulative: XLM,
        receipts_root: root(&f.e, 1),
        signature: BytesN::from_array(&f.e, &forged),
        acceptor: None,
        acceptance_signature: None,
    };
    assert_eq!(f.try_settle(&vec1(&f.e, v)), Outcome::Aborted);
    assert_eq!(f.client().claimable(&w), 0);
    assert_eq!(f.client().account(&reader).unwrap().balance, amount);
}

#[test]
fn non_canonical_signature_aborts() {
    // A signature with S + L in place of S satisfies the same group equation; the
    // host's strict check refuses it, and the canonical form still settles once.
    let f = Fixture::quiet();
    let (reader, key, key_id) = f.reader(10 * XLM, 10 * XLM);
    let w = Address::generate(&f.e);
    let v = f.voucher(&reader, &w, key_id, &key, XLM);
    let mut sig = v.signature.to_array();
    let mut carry = 0u16;
    for i in 0..32 {
        let sum = sig[32 + i] as u16 + GROUP_ORDER[i] as u16 + carry;
        sig[32 + i] = sum as u8;
        carry = sum >> 8;
    }
    assert_eq!(carry, 0);
    assert_eq!(
        f.try_settle(&vec1(&f.e, with_signature(&v, &f, sig))),
        Outcome::Aborted
    );
    assert_eq!(
        f.try_settle(&vec1(&f.e, v.clone())),
        summary(1, 0, XLM, fee(XLM).unwrap())
    );
    assert_eq!(f.try_settle(&vec1(&f.e, v)), summary(0, 1, 0, 0));
}

#[test]
fn signatures_do_not_cross_roles() {
    // I-14, I-18: a session signature is never an acceptance, and the reverse.
    let f = Fixture::quiet();
    let (reader, key, key_id) = f.reader(10 * XLM, 10 * XLM);
    let w = Address::generate(&f.e);
    let accepted = f.accept(
        &f.voucher(&reader, &w, key_id, &key, XLM),
        &key,
        &f.acceptor,
    );
    let mut swapped = accepted.clone();
    swapped.signature = accepted.acceptance_signature.clone().unwrap();
    swapped.acceptance_signature = Some(accepted.signature.clone());
    assert_eq!(
        f.try_settle_own(&w, &vec1(&f.e, swapped.clone())),
        Outcome::Aborted
    );
    assert_eq!(f.try_settle(&vec1(&f.e, swapped)), Outcome::Aborted);
    // The acceptor key signing the voucher payload is not a session signature.
    let bytes = f.payload_for(
        &f.tab,
        TESTNET_NETWORK_ID,
        &reader,
        &w,
        key_id,
        &key,
        XLM,
        &accepted.receipts_root,
    );
    let by_acceptor = with_signature(&accepted, &f, f.sign(&f.acceptor, &bytes).to_array());
    assert_eq!(
        f.try_settle_own(&w, &vec1(&f.e, by_acceptor)),
        Outcome::Aborted
    );
    assert_eq!(f.client().claimable(&w), 0);
}

#[test]
fn acceptance_signature_without_acceptor_is_not_accepted() {
    let f = Fixture::quiet();
    let (reader, key, key_id) = f.reader(10 * XLM, 10 * XLM);
    let w = Address::generate(&f.e);
    let mut half = f.accept(
        &f.voucher(&reader, &w, key_id, &key, XLM),
        &key,
        &f.acceptor,
    );
    half.acceptor = None;
    assert_eq!(
        f.try_settle_own(&w, &vec1(&f.e, half.clone())),
        summary(0, 1, 0, 0)
    );
    assert_eq!(
        f.tab_events(),
        std::vec![VoucherSkipped {
            reader: reader.clone(),
            writer: w.clone(),
            key_id,
            cumulative: XLM,
            reason: SKIP_NOT_ACCEPTED,
        }
        .to_xdr(&f.e, &f.tab)]
    );
    // The settler path ignores acceptance fields, including an invalid one.
    half.acceptance_signature = Some(BytesN::from_array(&f.e, &[7u8; 64]));
    assert_eq!(
        f.try_settle(&vec1(&f.e, half)),
        summary(1, 0, XLM, fee(XLM).unwrap())
    );
}

#[test]
fn a_new_key_with_the_same_public_key_does_not_replay() {
    // I-28, I-29: key IDs are never reused, so a voucher signed under an old key_id
    // cannot settle under a later registration of the same public key.
    let f = Fixture::quiet();
    let (reader, key, first) = f.reader(10 * XLM, 10 * XLM);
    let w = Address::generate(&f.e);
    let old = f.voucher(&reader, &w, first, &key, XLM);
    assert_eq!(
        f.try_settle(&vec1(&f.e, old.clone())),
        summary(1, 0, XLM, fee(XLM).unwrap())
    );
    let second = f.open_session(&reader, 0, &key, f.now() + DAY, 10 * XLM);
    assert_eq!(second, first + 1);
    let mut moved = old.clone();
    moved.key_id = second;
    assert_eq!(f.try_settle(&vec1(&f.e, moved)), Outcome::Aborted);
    assert_eq!(f.try_settle(&vec1(&f.e, old)), summary(0, 1, 0, 0));
}
