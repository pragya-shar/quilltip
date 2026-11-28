//! Grants: `grant_session` and `grant_gift` (a newcomer's first tip with no
//! signature of the reader's own). Invariants:
//!
//! - G-1 A grant never reduces, locks or redirects money the reader added:
//!   every tip spends gift first, a withdrawal pays everything but the unspent
//!   gift, and no grant lands on an account with a pending withdrawal.
//! - G-2 A granted key spends gift only, at most its cap, and nothing of the
//!   reader's later deposits; anything more needs a key the reader approved.
//! - G-3 Only a `grantor` grants; `grant_session` only onto an unused account
//!   (no balance, no key, no withdrawal), so it cannot be replayed or used to
//!   put a key on an existing reader.
//! - G-4 Pause blocks both entry points.
//! - G-5 Fee and settlement math are unchanged for a granted tip (97.5% and 2.5%).
//! - G-6 The gift never exceeds the balance; tokens held = balances + claimable.
//! - G-7 `grant_gift` with a key id raises only a live, unrevoked granted key,
//!   by exactly the gift; revoking that key never frees the gift for withdrawal.
use super::*;
use crate::contract::ROLE_GRANTOR;
use crate::{assert_tab_err, TabError};
use proptest::prelude::*;
use quilltip_shared::fee::tab_fee;
use quilltip_shared::DAY;
use soroban_sdk::Error;

const GIFT: i128 = 5 * XLM;
const TIP: i128 = XLM;

fn grantor(f: &Fixture) -> Address {
    let funder = Address::generate(&f.e);
    f.mint(&funder, MAX_BALANCE * 4);
    f.auth(
        &f.admin,
        "grant_role",
        (funder.clone(), ROLE_GRANTOR, f.admin.clone()).into_val(&f.e),
    );
    f.client().grant_role(&funder, &ROLE_GRANTOR, &f.admin);
    funder
}

type TryGrant =
    Result<Result<u32, soroban_sdk::ConversionError>, Result<Error, soroban_sdk::InvokeError>>;

fn try_grant(
    f: &Fixture,
    funder: &Address,
    reader: &Address,
    amount: i128,
    key: &ed25519_dalek::SigningKey,
    valid_until: u32,
    cap: i128,
) -> TryGrant {
    let pk = public_key(&f.e, key);
    let args = (
        funder.clone(),
        reader.clone(),
        amount,
        pk.clone(),
        valid_until,
        cap,
    )
        .into_val(&f.e);
    f.auth_with_transfer(funder, "grant_session", args, amount);
    f.client()
        .try_grant_session(funder, reader, &amount, &pk, &valid_until, &cap)
}

fn grant(
    f: &Fixture,
    funder: &Address,
    reader: &Address,
    amount: i128,
    key: &ed25519_dalek::SigningKey,
    cap: i128,
) -> u32 {
    let valid_until = f.now() + DAY + DAY / 24;
    try_grant(f, funder, reader, amount, key, valid_until, cap)
        .expect("grant_session")
        .expect("key id")
}

type TryGift =
    Result<Result<(), soroban_sdk::ConversionError>, Result<Error, soroban_sdk::InvokeError>>;

fn try_gift(f: &Fixture, funder: &Address, reader: &Address, amount: i128) -> TryGift {
    try_gift_key(f, funder, reader, amount, None)
}

fn try_gift_key(
    f: &Fixture,
    funder: &Address,
    reader: &Address,
    amount: i128,
    key_id: Option<u32>,
) -> TryGift {
    f.auth_with_transfer(
        funder,
        "grant_gift",
        (funder.clone(), reader.clone(), amount, key_id).into_val(&f.e),
        amount,
    );
    f.client().try_grant_gift(funder, reader, &amount, &key_id)
}

fn revoke(f: &Fixture, reader: &Address, key_id: u32) {
    f.auth(
        reader,
        "revoke_key",
        (reader.clone(), key_id).into_val(&f.e),
    );
    f.client().revoke_key(reader, &key_id);
}

fn own_key(
    f: &Fixture,
    reader: &Address,
    label: &str,
    cap: i128,
) -> (ed25519_dalek::SigningKey, u32) {
    let k = signing_key(label);
    let id = f.open_session(reader, 0, &k, f.now() + 7 * DAY, cap);
    (k, id)
}

fn tip(
    f: &Fixture,
    reader: &Address,
    writer: &Address,
    key_id: u32,
    key: &ed25519_dalek::SigningKey,
    cumulative: i128,
) -> crate::SettleSummary {
    f.settle(&vec1(
        &f.e,
        f.voucher(reader, writer, key_id, key, cumulative),
    ))
}

fn unauthorized() -> Option<Result<Error, soroban_sdk::InvokeError>> {
    Some(Ok(Error::from_contract_error(2000)))
}

#[test]
fn grant_session_gives_a_balance_and_a_key_capped_at_the_gift() {
    let f = Fixture::new();
    let funder = grantor(&f);
    let reader = Address::generate(&f.e);
    let key = signing_key("newcomer");
    let before = f.balance(&funder);
    let key_id = grant(&f, &funder, &reader, GIFT, &key, TIP);
    // Deposited, KeyRegistered and SessionGranted, as `open_session` publishes the first two.
    assert_eq!(f.tab_events().len(), 3);
    assert_eq!(key_id, 0);
    assert_eq!(f.balance(&funder), before - GIFT);
    let acct = f.client().account(&reader).unwrap();
    assert_eq!(acct.balance, GIFT);
    assert_eq!(f.client().gift(&reader), GIFT);
    assert!(f.client().is_granted_key(&reader, &key_id));
    let k = f.client().session_key(&reader, &key_id).unwrap();
    assert_eq!(k.spend_limit, TIP);
}

#[test]
fn g3_only_a_grantor_grants() {
    let f = Fixture::new();
    let stranger = Address::generate(&f.e);
    f.mint(&stranger, MAX_BALANCE);
    let reader = Address::generate(&f.e);
    let r = try_grant(
        &f,
        &stranger,
        &reader,
        GIFT,
        &signing_key("k"),
        f.now() + 2 * DAY,
        TIP,
    );
    assert_eq!(r.err(), unauthorized());
    assert_eq!(try_gift(&f, &stranger, &reader, GIFT).err(), unauthorized());
    assert!(f.client().account(&reader).is_none());
}

#[test]
fn g2_cap_above_the_gift_is_refused() {
    let f = Fixture::new();
    let funder = grantor(&f);
    let reader = Address::generate(&f.e);
    let k = signing_key("k");
    let until = f.now() + 2 * DAY;
    assert_tab_err!(
        try_grant(&f, &funder, &reader, GIFT, &k, until, GIFT + 1),
        TabError::GrantCapAboveAmount
    );
    assert_tab_err!(
        try_grant(&f, &funder, &reader, GIFT, &k, until, 0),
        TabError::InvalidKey
    );
    assert_tab_err!(
        try_grant(&f, &funder, &reader, MIN_DEPOSIT - 1, &k, until, 1),
        TabError::BelowMinimumDeposit
    );
    assert_tab_err!(
        try_grant(&f, &funder, &reader, GIFT, &k, f.now(), TIP),
        TabError::InvalidKeyExpiry
    );
}

#[test]
fn g3_no_grant_onto_an_account_in_use_and_no_replay() {
    let f = Fixture::new();
    let funder = grantor(&f);
    let until = f.now() + 2 * DAY;
    // A reader who deposited their own money.
    let (with_balance, _, _) = f.reader(10 * XLM, 10 * XLM);
    assert_tab_err!(
        try_grant(
            &f,
            &funder,
            &with_balance,
            GIFT,
            &signing_key("a"),
            until,
            TIP
        ),
        TabError::GrantAccountInUse
    );
    // A reader with a key and no balance.
    let keyed = Address::generate(&f.e);
    own_key(&f, &keyed, "keyed", XLM);
    assert_tab_err!(
        try_grant(&f, &funder, &keyed, GIFT, &signing_key("b"), until, TIP),
        TabError::GrantAccountInUse
    );
    // The same grant twice.
    let fresh = Address::generate(&f.e);
    grant(&f, &funder, &fresh, GIFT, &signing_key("c"), TIP);
    assert_tab_err!(
        try_grant(&f, &funder, &fresh, GIFT, &signing_key("c"), until, TIP),
        TabError::GrantAccountInUse
    );
    assert_eq!(f.client().account(&fresh).unwrap().next_key_id, 1);
}

#[test]
fn g1_no_gift_onto_a_pending_withdrawal() {
    let f = Fixture::new();
    let funder = grantor(&f);
    let (reader, _, _) = f.reader(10 * XLM, 10 * XLM);
    f.withdraw_start(&reader);
    assert_tab_err!(
        try_gift(&f, &funder, &reader, GIFT),
        TabError::WithdrawPending
    );
    // The withdrawal is untouched.
    assert_ne!(f.client().account(&reader).unwrap().withdraw_unlock, 0);
}

#[test]
fn g4_pause_blocks_grants() {
    let f = Fixture::new();
    let funder = grantor(&f);
    f.pause();
    let reader = Address::generate(&f.e);
    assert!(try_grant(
        &f,
        &funder,
        &reader,
        GIFT,
        &signing_key("p"),
        f.now() + 2 * DAY,
        TIP
    )
    .is_err());
    assert!(try_gift(&f, &funder, &reader, GIFT).is_err());
    f.unpause();
    grant(&f, &funder, &reader, GIFT, &signing_key("p"), TIP);
}

#[test]
fn g5_a_granted_tip_settles_with_the_same_fee_math() {
    let f = Fixture::new();
    let funder = grantor(&f);
    let reader = Address::generate(&f.e);
    let writer = Address::generate(&f.e);
    let key = signing_key("fee");
    let key_id = grant(&f, &funder, &reader, GIFT, &key, TIP);
    let s = tip(&f, &reader, &writer, key_id, &key, TIP);
    let fee = tab_fee(0, TIP).unwrap();
    assert_eq!((s.settled, s.gross, s.fee), (1, TIP, fee));
    assert_eq!(f.client().claimable(&writer), TIP - fee);
    assert_eq!(f.client().claimable(&f.treasury), fee);
    assert_eq!(fee * 40, TIP); // 2.5%
    assert_eq!(f.client().gift(&reader), GIFT - TIP);
}

#[test]
fn g2_granted_key_spends_at_most_its_cap() {
    let f = Fixture::new();
    let funder = grantor(&f);
    let reader = Address::generate(&f.e);
    let writer = Address::generate(&f.e);
    let key = signing_key("cap");
    let key_id = grant(&f, &funder, &reader, GIFT, &key, TIP);
    assert_eq!(tip(&f, &reader, &writer, key_id, &key, TIP).gross, TIP);
    // A second tip under the same key: nothing left under the cap.
    let s = tip(&f, &reader, &writer, key_id, &key, 2 * TIP);
    assert_eq!((s.settled, s.skipped), (0, 1));
    assert_eq!(f.client().account(&reader).unwrap().balance, GIFT - TIP);
}

#[test]
fn g2_granted_key_never_spends_later_deposits() {
    let f = Fixture::new();
    let funder = grantor(&f);
    let reader = Address::generate(&f.e);
    f.mint(&reader, MAX_BALANCE);
    let writer = Address::generate(&f.e);
    let gk = signing_key("gift-key");
    let gift_key = grant(&f, &funder, &reader, GIFT, &gk, GIFT);
    // The reader approves a key of their own and spends the whole gift with it.
    let (ok, own) = own_key(&f, &reader, "own", 100 * XLM);
    assert_eq!(tip(&f, &reader, &writer, own, &ok, GIFT).gross, GIFT);
    assert_eq!(f.client().gift(&reader), 0);
    // Then the reader adds their own money.
    f.deposit(&reader, 10 * XLM);
    // The granted key, with its whole cap unused, cannot touch it.
    let s = tip(&f, &reader, &writer, gift_key, &gk, TIP);
    assert_eq!((s.settled, s.skipped), (0, 1));
    assert_eq!(f.client().account(&reader).unwrap().balance, 10 * XLM);
}

#[test]
fn g1_tips_spend_gift_first_and_withdrawal_pays_all_own_money() {
    let f = Fixture::new();
    let funder = grantor(&f);
    let reader = Address::generate(&f.e);
    f.mint(&reader, MAX_BALANCE);
    let writer = Address::generate(&f.e);
    let gk = signing_key("g1");
    let gift_key = grant(&f, &funder, &reader, GIFT, &gk, TIP);
    f.deposit(&reader, 10 * XLM);
    assert_eq!(tip(&f, &reader, &writer, gift_key, &gk, TIP).gross, TIP);
    // An own key's tip spends the rest of the gift before own money.
    let (ok, own) = own_key(&f, &reader, "own-g1", 100 * XLM);
    assert_eq!(tip(&f, &reader, &writer, own, &ok, 2 * XLM).gross, 2 * XLM);
    assert_eq!(f.client().gift(&reader), GIFT - TIP - 2 * XLM);
    // Withdrawal pays every unit of own money; the gift stays.
    let before = f.balance(&reader);
    f.withdraw_start(&reader);
    f.advance(crate::WITHDRAW_DELAY);
    assert_eq!(f.withdraw(&reader), 10 * XLM);
    assert_eq!(f.balance(&reader), before + 10 * XLM);
    let acct = f.client().account(&reader).unwrap();
    assert_eq!(acct.balance, 2 * XLM);
    assert_eq!(f.client().gift(&reader), 2 * XLM);
}

#[test]
fn g1_a_gift_alone_cannot_be_withdrawn() {
    let f = Fixture::new();
    let funder = grantor(&f);
    let reader = Address::generate(&f.e);
    grant(&f, &funder, &reader, GIFT, &signing_key("w"), TIP);
    f.auth(&reader, "withdraw_start", (reader.clone(),).into_val(&f.e));
    assert_tab_err!(
        f.client().try_withdraw_start(&reader),
        TabError::NothingToWithdraw
    );
}

#[test]
fn g1_a_withdrawal_never_takes_gift_money_while_a_tip_waits_to_settle() {
    // An own-key tip the server accepted (it counted the gift as spent first)
    // settles before or after the withdrawal: either way the withdrawal pays
    // exactly the reader's own money, and the tip is paid in full.
    for settle_first in [true, false] {
        let f = Fixture::quiet();
        let funder = grantor(&f);
        let reader = Address::generate(&f.e);
        f.mint(&reader, MAX_BALANCE);
        let writer = Address::generate(&f.e);
        grant(&f, &funder, &reader, GIFT, &signing_key("wait-gift"), GIFT);
        f.deposit(&reader, 10 * XLM);
        let (ok, own) = own_key(&f, &reader, "wait-own", 100 * XLM);
        let voucher = f.voucher(&reader, &writer, own, &ok, 4 * XLM);
        if settle_first {
            assert_eq!(f.settle(&vec1(&f.e, voucher.clone())).gross, 4 * XLM);
        }
        let before = f.balance(&reader);
        f.withdraw_start(&reader);
        f.advance(crate::WITHDRAW_DELAY);
        assert_eq!(f.withdraw(&reader), 10 * XLM, "settle_first={settle_first}");
        assert_eq!(f.balance(&reader), before + 10 * XLM);
        if !settle_first {
            assert_eq!(f.settle(&vec1(&f.e, voucher)).gross, 4 * XLM);
        }
        // What is left is gift, and it is exactly the gift less the tip.
        let acct = f.client().account(&reader).unwrap();
        assert_eq!(acct.balance, GIFT - 4 * XLM);
        assert_eq!(f.client().gift(&reader), GIFT - 4 * XLM);
    }
}

#[test]
fn grant_gift_adds_practice_money_with_no_key() {
    let f = Fixture::new();
    let funder = grantor(&f);
    let reader = Address::generate(&f.e);
    let gk = signing_key("first");
    grant(&f, &funder, &reader, GIFT, &gk, TIP);
    try_gift(&f, &funder, &reader, GIFT).unwrap().unwrap();
    assert_eq!(f.client().gift(&reader), 2 * GIFT);
    assert_eq!(f.client().account(&reader).unwrap().next_key_id, 1);
}

#[test]
fn reader_revokes_a_granted_key() {
    let f = Fixture::new();
    let funder = grantor(&f);
    let reader = Address::generate(&f.e);
    let key_id = grant(&f, &funder, &reader, GIFT, &signing_key("r"), TIP);
    revoke(&f, &reader, key_id);
    assert!(f.client().session_key(&reader, &key_id).unwrap().revoked);
}

#[test]
fn g7_revoking_the_gift_key_does_not_free_the_gift() {
    let f = Fixture::new();
    let funder = grantor(&f);
    let reader = Address::generate(&f.e);
    f.mint(&reader, MAX_BALANCE);
    let key_id = grant(&f, &funder, &reader, GIFT, &signing_key("rv"), GIFT);
    f.deposit(&reader, 10 * XLM);
    revoke(&f, &reader, key_id);
    // The counter is unchanged by the revocation.
    assert_eq!(f.client().gift(&reader), GIFT);
    let before = f.balance(&reader);
    f.withdraw_start(&reader);
    f.advance(crate::WITHDRAW_DELAY);
    // Exactly the reader's own money leaves; the gift stays in the balance.
    assert_eq!(f.withdraw(&reader), 10 * XLM);
    assert_eq!(f.balance(&reader), before + 10 * XLM);
    assert_eq!(f.client().account(&reader).unwrap().balance, GIFT);
    assert_eq!(f.client().gift(&reader), GIFT);
    // And with only the gift left, nothing can be withdrawn.
    f.auth(&reader, "withdraw_start", (reader.clone(),).into_val(&f.e));
    assert_tab_err!(
        f.client().try_withdraw_start(&reader),
        TabError::NothingToWithdraw
    );
}

#[test]
fn g1_withdrawal_pays_exactly_own_money_while_a_gift_is_unspent() {
    let f = Fixture::new();
    let funder = grantor(&f);
    let reader = Address::generate(&f.e);
    f.mint(&reader, MAX_BALANCE);
    grant(&f, &funder, &reader, GIFT, &signing_key("own-only"), GIFT);
    f.deposit(&reader, 7 * XLM);
    f.deposit(&reader, 3 * XLM);
    assert_eq!(f.client().gift(&reader), GIFT);
    let before = f.balance(&reader);
    f.withdraw_start(&reader);
    f.advance(crate::WITHDRAW_DELAY);
    assert_eq!(f.withdraw(&reader), 10 * XLM);
    assert_eq!(f.balance(&reader), before + 10 * XLM);
    assert_eq!(f.client().account(&reader).unwrap().balance, GIFT);
}

#[test]
fn g7_a_second_grant_adds_to_the_counter_and_raises_the_same_key() {
    let f = Fixture::new();
    let funder = grantor(&f);
    let reader = Address::generate(&f.e);
    let writer = Address::generate(&f.e);
    let gk = signing_key("second");
    let key_id = grant(&f, &funder, &reader, GIFT, &gk, GIFT);
    assert_eq!(
        tip(&f, &reader, &writer, key_id, &gk, 4 * XLM).gross,
        4 * XLM
    );
    assert_eq!(f.client().gift(&reader), XLM);
    try_gift_key(&f, &funder, &reader, GIFT, Some(key_id))
        .unwrap()
        .unwrap();
    // Deposited, GrantKeyRaised and GiftGranted.
    assert_eq!(f.tab_events().len(), 3);
    assert_eq!(f.client().gift(&reader), XLM + GIFT);
    let k = f.client().session_key(&reader, &key_id).unwrap();
    assert_eq!(k.spend_limit, 2 * GIFT);
    assert_eq!(f.client().account(&reader).unwrap().next_key_id, 1);
    // The same key keeps tipping, up to the whole gift and no further.
    let s = tip(&f, &reader, &writer, key_id, &gk, 4 * XLM + 7 * XLM);
    assert_eq!(s.gross, XLM + GIFT);
    assert_eq!(f.client().gift(&reader), 0);
}

#[test]
fn g7_only_a_live_granted_key_is_raised() {
    let f = Fixture::new();
    let funder = grantor(&f);
    let reader = Address::generate(&f.e);
    let gift_key = grant(&f, &funder, &reader, GIFT, &signing_key("live"), GIFT);
    let (_, own) = own_key(&f, &reader, "own-raise", XLM);
    // A key the reader approved, and a key that does not exist.
    for id in [own, 7] {
        assert_tab_err!(
            try_gift_key(&f, &funder, &reader, GIFT, Some(id)),
            TabError::GrantKeyNotLive
        );
    }
    assert_eq!(
        f.client().session_key(&reader, &own).unwrap().spend_limit,
        XLM
    );
    // A granted key past its end.
    f.advance(DAY + DAY / 24 + 1);
    assert_tab_err!(
        try_gift_key(&f, &funder, &reader, GIFT, Some(gift_key)),
        TabError::GrantKeyNotLive
    );
    // A revoked granted key.
    let other = Address::generate(&f.e);
    let rk = grant(&f, &funder, &other, GIFT, &signing_key("rk"), GIFT);
    revoke(&f, &other, rk);
    assert_tab_err!(
        try_gift_key(&f, &funder, &other, GIFT, Some(rk)),
        TabError::GrantKeyNotLive
    );
    // Nothing moved on any refusal.
    assert_eq!(f.client().gift(&reader), GIFT);
    assert_eq!(f.client().gift(&other), GIFT);
    assert_eq!(
        f.client()
            .session_key(&reader, &gift_key)
            .unwrap()
            .spend_limit,
        GIFT
    );
}

#[test]
fn g2_a_granted_key_spends_gift_only_up_to_its_settle_deadline() {
    // The `Granted` mark lives exactly as long as the key's settle window.
    let f = Fixture::new();
    let funder = grantor(&f);
    let reader = Address::generate(&f.e);
    f.mint(&reader, MAX_BALANCE);
    let writer = Address::generate(&f.e);
    let gk = signing_key("deadline");
    let valid_until = f.now() + DAY;
    let key_id = try_grant(&f, &funder, &reader, GIFT, &gk, valid_until, GIFT)
        .unwrap()
        .unwrap();
    let (ok, own) = own_key(&f, &reader, "own-deadline", 100 * XLM);
    assert_eq!(tip(&f, &reader, &writer, own, &ok, 4 * XLM).gross, 4 * XLM);
    f.deposit(&reader, 10 * XLM);
    f.e.ledger()
        .set_sequence_number(crate::storage::settle_deadline(valid_until));
    assert!(f.client().is_granted_key(&reader, &key_id));
    // At the last ledger it may settle, the granted key still spends gift only.
    assert_eq!(tip(&f, &reader, &writer, key_id, &gk, 3 * XLM).gross, XLM);
    assert_eq!(f.client().account(&reader).unwrap().balance, 10 * XLM);
}

// ----- Accounting across any order of operations -----

#[derive(Clone, Debug)]
enum Op {
    Grant(i128, i128),
    Gift(i128, bool),
    RevokeGiftKey,
    Deposit(i128),
    OwnKey,
    Tip(bool, i128),
    WithdrawStart,
    Withdraw,
    Advance(u32),
}

fn op() -> impl Strategy<Value = Op> {
    prop_oneof![
        (MIN_DEPOSIT..=8 * XLM, 1i128..=8 * XLM).prop_map(|(a, c)| Op::Grant(a, c)),
        (MIN_DEPOSIT..=5 * XLM, any::<bool>()).prop_map(|(a, r)| Op::Gift(a, r)),
        Just(Op::RevokeGiftKey),
        (MIN_DEPOSIT..=5 * XLM).prop_map(Op::Deposit),
        Just(Op::OwnKey),
        (any::<bool>(), 1i128..=3 * XLM).prop_map(|(g, a)| Op::Tip(g, a)),
        Just(Op::WithdrawStart),
        Just(Op::Withdraw),
        (0u32..=2 * DAY).prop_map(Op::Advance),
    ]
}

/// The model: the reader's own money and the gift, tracked apart.
struct Model {
    own: i128,
    gift: i128,
    granted_spent: i128,
    granted_cap: i128,
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 64, .. ProptestConfig::default() })]

    #[test]
    fn grant_accounting_holds_for_any_order(ops in proptest::collection::vec(op(), 1..24)) {
        let f = Fixture::quiet();
        let funder = grantor(&f);
        let reader = Address::generate(&f.e);
        f.mint(&reader, MAX_BALANCE * 2);
        let writer = Address::generate(&f.e);
        let gk = signing_key("prop-gift");
        let ok = signing_key("prop-own");
        let mut gift_key: Option<u32> = None;
        let mut gift_key_until = 0u32;
        let mut gift_key_revoked = false;
        let mut own_key_id: Option<u32> = None;
        let mut cum = [0i128; 2];
        let mut m = Model { own: 0, gift: 0, granted_spent: 0, granted_cap: 0 };
        let pending = |f: &Fixture| f.client().account(&reader).map(|a| a.withdraw_unlock != 0).unwrap_or(false);

        for o in ops {
            match o {
                Op::Grant(a, c) => {
                    let fresh = f.client().account(&reader).map(|x| x.balance == 0 && x.next_key_id == 0 && x.withdraw_unlock == 0).unwrap_or(true);
                    let until = f.now() + 2 * DAY;
                    let r = try_grant(&f, &funder, &reader, a, &gk, until, c);
                    if fresh && c <= a && m.own + m.gift + a <= MAX_BALANCE {
                        gift_key = Some(r.expect("grant").expect("id"));
                        gift_key_until = until;
                        m.gift += a;
                        m.granted_cap = c;
                    } else {
                        prop_assert!(r.is_err());
                    }
                }
                Op::Gift(a, raise) => {
                    let key = if raise { gift_key } else { None };
                    let live = key.is_some() && !gift_key_revoked && f.now() <= gift_key_until;
                    let r = try_gift_key(&f, &funder, &reader, a, key);
                    if !pending(&f) && (key.is_none() || live) && m.own + m.gift + a <= MAX_BALANCE {
                        prop_assert!(r.is_ok());
                        m.gift += a;
                        if key.is_some() {
                            m.granted_cap += a;
                        }
                    } else {
                        prop_assert!(r.is_err());
                    }
                }
                Op::RevokeGiftKey => {
                    if let Some(id) = gift_key.filter(|id| f.client().session_key(&reader, id).is_some()) {
                        revoke(&f, &reader, id);
                        gift_key_revoked = true;
                        gift_key_until = gift_key_until.min(f.now());
                    }
                }
                Op::Deposit(a) => {
                    if m.own + m.gift + a <= MAX_BALANCE {
                        f.deposit(&reader, a);
                        m.own += a;
                    }
                }
                Op::OwnKey => {
                    if own_key_id.is_none() {
                        own_key_id = Some(f.open_session(&reader, 0, &ok, f.now() + 20 * DAY, 100 * XLM));
                    }
                }
                Op::Tip(granted, a) => {
                    let (key, key_id, slot) = if granted {
                        match gift_key { Some(id) => (&gk, id, 0), None => continue }
                    } else {
                        match own_key_id { Some(id) => (&ok, id, 1), None => continue }
                    };
                    cum[slot] += a;
                    let s = tip(&f, &reader, &writer, key_id, key, cum[slot]);
                    let g = s.gross;
                    if granted {
                        prop_assert!(g <= m.gift, "a granted key spent more than the gift");
                        m.gift -= g;
                        m.granted_spent += g;
                    } else {
                        let from_gift = g.min(m.gift);
                        m.gift -= from_gift;
                        m.own -= g - from_gift;
                    }
                }
                Op::WithdrawStart => {
                    f.auth(&reader, "withdraw_start", (reader.clone(),).into_val(&f.e));
                    let _ = f.client().try_withdraw_start(&reader);
                }
                Op::Withdraw => {
                    f.auth(&reader, "withdraw", (reader.clone(),).into_val(&f.e));
                    if let Ok(Ok(paid)) = f.client().try_withdraw(&reader) {
                        // G-1: a withdrawal pays exactly the reader's own money.
                        prop_assert_eq!(paid, m.own);
                        m.own = 0;
                    }
                }
                Op::Advance(n) => f.advance(n),
            }
            let bal = f.client().account(&reader).map(|a| a.balance).unwrap_or(0);
            let gift = f.client().gift(&reader);
            // G-6 and the model.
            prop_assert!(gift <= bal);
            prop_assert_eq!(gift, m.gift);
            prop_assert_eq!(bal - gift, m.own);
            prop_assert!(m.own >= 0);
            // G-2: a granted key never spends beyond its cap.
            prop_assert!(m.granted_spent <= m.granted_cap);
            // Tokens held = balances + claimable.
            prop_assert_eq!(f.balance(&f.tab), bal + f.client().claimable(&writer) + f.client().claimable(&f.treasury));
        }
    }
}
