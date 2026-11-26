//! Reader operations: deposit, keys, revocation, withdrawal, and TTL.
use super::*;
use crate::events::{
    Deposited, KeyRegistered, KeyRevoked, WithdrawCancelled, WithdrawStarted, Withdrawn,
};
use crate::storage::TabKey;
use crate::{TabError, MAX_KEY_LIFETIME, SETTLE_GRACE, WITHDRAW_DELAY};
use quilltip_shared::{TTL_EXTEND_TO, TTL_THRESHOLD};
use soroban_sdk::testutils::storage::{Instance as _, Persistent as _, Temporary as _};
use soroban_sdk::Event as _;

fn funded(f: &Fixture) -> Address {
    let reader = Address::generate(&f.e);
    f.mint(&reader, MAX_BALANCE * 2);
    reader
}

fn try_deposit(f: &Fixture, reader: &Address, amount: i128) -> bool {
    f.auth_with_transfer(
        reader,
        "deposit",
        (reader.clone(), amount).into_val(&f.e),
        amount,
    );
    f.client().try_deposit(reader, &amount).is_ok()
}

fn try_register(
    f: &Fixture,
    reader: &Address,
    pk: &BytesN<32>,
    valid_until: u32,
    limit: i128,
) -> Result<u32, Option<TabError>> {
    f.auth(
        reader,
        "register_key",
        (reader.clone(), pk.clone(), valid_until, limit).into_val(&f.e),
    );
    match f
        .client()
        .try_register_key(reader, pk, &valid_until, &limit)
    {
        Ok(Ok(id)) => Ok(id),
        Err(Ok(e)) => Err(tab_error(&e)),
        _ => Err(None),
    }
}

#[test]
fn deposit_moves_tokens_and_emits() {
    // I-10: the Tab's token balance equals the reader balance after a deposit.
    let f = Fixture::new();
    let reader = funded(&f);
    f.deposit(&reader, 3 * XLM);
    assert_eq!(
        f.tab_events(),
        std::vec![Deposited {
            reader: reader.clone(),
            amount: 3 * XLM,
            balance_after: 3 * XLM
        }
        .to_xdr(&f.e, &f.tab)]
    );
    f.deposit(&reader, MIN_DEPOSIT);
    let acct = f.client().account(&reader).unwrap();
    assert_eq!(
        acct,
        crate::ReaderAccount {
            balance: 3 * XLM + MIN_DEPOSIT,
            next_key_id: 0,
            withdraw_unlock: 0
        }
    );
    assert_eq!(f.balance(&f.tab), acct.balance);
}

#[test]
fn deposit_errors() {
    let f = Fixture::new();
    let reader = funded(&f);
    for amount in [MIN_DEPOSIT - 1, 0, -1] {
        f.auth_with_transfer(
            &reader,
            "deposit",
            (reader.clone(), amount).into_val(&f.e),
            amount,
        );
        crate::assert_tab_err!(
            f.client().try_deposit(&reader, &amount),
            TabError::BelowMinimumDeposit
        );
    }
    f.deposit(&reader, MAX_BALANCE - MIN_DEPOSIT);
    f.auth_with_transfer(
        &reader,
        "deposit",
        (reader.clone(), MIN_DEPOSIT + 1).into_val(&f.e),
        MIN_DEPOSIT + 1,
    );
    crate::assert_tab_err!(
        f.client().try_deposit(&reader, &(MIN_DEPOSIT + 1)),
        TabError::BalanceCapExceeded
    );
    // Exactly at the cap is allowed.
    assert!(try_deposit(&f, &reader, MIN_DEPOSIT));
    // Without the reader's authorisation: refused.
    let other = funded(&f);
    f.auth(
        &reader,
        "deposit",
        (other.clone(), MIN_DEPOSIT).into_val(&f.e),
    );
    assert!(f.client().try_deposit(&other, &MIN_DEPOSIT).is_err());
}

#[test]
fn register_key_assigns_increasing_ids_and_emits() {
    // I-28: key IDs start at 0 and never repeat.
    let f = Fixture::new();
    let reader = funded(&f);
    let valid_until = f.now() + 100;
    for expected in 0..3u32 {
        let pk = public_key(&f.e, &signing_key(&std::format!("k{expected}")));
        assert_eq!(
            try_register(&f, &reader, &pk, valid_until, XLM),
            Ok(expected)
        );
        assert_eq!(
            f.tab_events(),
            std::vec![KeyRegistered {
                reader: reader.clone(),
                key_id: expected,
                public_key: pk.clone(),
                valid_until,
                spend_limit: XLM
            }
            .to_xdr(&f.e, &f.tab)]
        );
        let key = f.client().session_key(&reader, &expected).unwrap();
        assert_eq!(
            key,
            crate::SessionKey {
                public_key: pk,
                valid_until,
                spend_limit: XLM,
                spent: 0,
                revoked: false
            }
        );
    }
    // The account exists without a deposit (created on first use).
    assert_eq!(f.client().account(&reader).unwrap().next_key_id, 3);
}

#[test]
fn register_key_errors_and_boundaries() {
    let f = Fixture::new();
    let reader = funded(&f);
    let pk = public_key(&f.e, &signing_key("k"));
    let now = f.now();
    assert_eq!(
        try_register(&f, &reader, &pk, now, XLM),
        Err(Some(TabError::InvalidKeyExpiry))
    );
    assert_eq!(
        try_register(&f, &reader, &pk, now - 1, XLM),
        Err(Some(TabError::InvalidKeyExpiry))
    );
    assert_eq!(
        try_register(&f, &reader, &pk, now + MAX_KEY_LIFETIME + 1, XLM),
        Err(Some(TabError::InvalidKeyExpiry))
    );
    assert_eq!(
        try_register(&f, &reader, &pk, now + MAX_KEY_LIFETIME, XLM),
        Ok(0)
    );
    assert_eq!(try_register(&f, &reader, &pk, now + 1, XLM), Ok(1));
    let zero = BytesN::from_array(&f.e, &[0; 32]);
    assert_eq!(
        try_register(&f, &reader, &zero, now + 10, XLM),
        Err(Some(TabError::InvalidKey))
    );
    assert_eq!(
        try_register(&f, &reader, &pk, now + 10, 0),
        Err(Some(TabError::InvalidKey))
    );
    assert_eq!(
        try_register(&f, &reader, &pk, now + 10, -1),
        Err(Some(TabError::InvalidKey))
    );
    // A failed call does not consume a key ID (I-28).
    assert_eq!(try_register(&f, &reader, &pk, now + 10, XLM), Ok(2));
}

#[test]
fn key_id_overflow_is_an_error() {
    let f = Fixture::new();
    let reader = funded(&f);
    f.e.as_contract(&f.tab, || {
        crate::storage::set_account(
            &f.e,
            &reader,
            &crate::ReaderAccount {
                balance: 0,
                next_key_id: u32::MAX,
                withdraw_unlock: 0,
            },
        );
    });
    let pk = public_key(&f.e, &signing_key("k"));
    assert_eq!(
        try_register(&f, &reader, &pk, f.now() + 10, XLM),
        Err(Some(TabError::Overflow))
    );
}

#[test]
fn open_session_combines_deposit_and_key() {
    let f = Fixture::new();
    let reader = funded(&f);
    let key = signing_key("s");
    let pk = public_key(&f.e, &key);
    let until = f.now() + 50;
    // Zero amount: key only, no transfer authorised or needed.
    assert_eq!(f.open_session(&reader, 0, &key, until, XLM), 0);
    assert_eq!(f.client().account(&reader).unwrap().balance, 0);
    // Positive amount: one call emits Deposited then KeyRegistered.
    assert_eq!(f.open_session(&reader, 2 * XLM, &key, until, XLM), 1);
    assert_eq!(
        f.tab_events(),
        std::vec![
            Deposited {
                reader: reader.clone(),
                amount: 2 * XLM,
                balance_after: 2 * XLM
            }
            .to_xdr(&f.e, &f.tab),
            KeyRegistered {
                reader: reader.clone(),
                key_id: 1,
                public_key: pk.clone(),
                valid_until: until,
                spend_limit: XLM
            }
            .to_xdr(&f.e, &f.tab),
        ]
    );
    // Negative amount, bad key and low deposit are refused before anything changes.
    let cases: [(i128, u32, i128, TabError); 3] = [
        (-1, until, XLM, TabError::InvalidAmount),
        (XLM, f.now(), XLM, TabError::InvalidKeyExpiry),
        (MIN_DEPOSIT - 1, until, XLM, TabError::BelowMinimumDeposit),
    ];
    for (amount, vu, limit, expected) in cases {
        let args = (reader.clone(), amount, pk.clone(), vu, limit).into_val(&f.e);
        if amount > 0 {
            f.auth_with_transfer(&reader, "open_session", args, amount);
        } else {
            f.auth(&reader, "open_session", args);
        }
        crate::assert_tab_err!(
            f.client()
                .try_open_session(&reader, &amount, &pk, &vu, &limit),
            expected
        );
    }
    assert_eq!(f.client().account(&reader).unwrap().next_key_id, 2);
}

#[test]
fn revoke_key_sets_flag_and_lowers_valid_until() {
    let f = Fixture::new();
    let (reader, _, key_id) = f.reader(2 * XLM, XLM);
    let before = f.client().session_key(&reader, &key_id).unwrap();
    f.advance(10);
    f.auth(
        &reader,
        "revoke_key",
        (reader.clone(), key_id).into_val(&f.e),
    );
    f.client().revoke_key(&reader, &key_id);
    assert_eq!(
        f.tab_events(),
        std::vec![KeyRevoked {
            reader: reader.clone(),
            key_id,
            valid_until: f.now()
        }
        .to_xdr(&f.e, &f.tab)]
    );
    let after = f.client().session_key(&reader, &key_id).unwrap();
    assert!(after.revoked);
    assert_eq!(after.valid_until, f.now());
    assert!(after.valid_until < before.valid_until);
    // Unknown key.
    f.auth(&reader, "revoke_key", (reader.clone(), 7u32).into_val(&f.e));
    crate::assert_tab_err!(
        f.client().try_revoke_key(&reader, &7),
        TabError::KeyNotFound
    );
    // Another address cannot revoke.
    let other = Address::generate(&f.e);
    f.auth(
        &other,
        "revoke_key",
        (reader.clone(), key_id).into_val(&f.e),
    );
    assert!(f.client().try_revoke_key(&reader, &key_id).is_err());
}

#[test]
fn withdrawal_waits_the_delay_and_pays_the_balance() {
    // I-16: withdraw succeeds only WITHDRAW_DELAY after withdraw_start, pays the
    // whole balance to the reader, and keeps the account (I-28).
    let f = Fixture::new();
    let (reader, _, _) = f.reader(5 * XLM, XLM);
    let wallet = f.balance(&reader);
    f.withdraw_start(&reader);
    let unlock = f.now() + WITHDRAW_DELAY;
    assert_eq!(
        f.tab_events(),
        std::vec![WithdrawStarted {
            reader: reader.clone(),
            balance: 5 * XLM,
            unlock_ledger: unlock
        }
        .to_xdr(&f.e, &f.tab)]
    );
    f.auth(&reader, "withdraw_start", (reader.clone(),).into_val(&f.e));
    crate::assert_tab_err!(
        f.client().try_withdraw_start(&reader),
        TabError::WithdrawPending
    );
    f.e.ledger().set_sequence_number(unlock - 1);
    f.auth(&reader, "withdraw", (reader.clone(),).into_val(&f.e));
    crate::assert_tab_err!(f.client().try_withdraw(&reader), TabError::WithdrawLocked);
    f.e.ledger().set_sequence_number(unlock);
    assert_eq!(f.withdraw(&reader), 5 * XLM);
    assert_eq!(
        f.tab_events(),
        std::vec![Withdrawn {
            reader: reader.clone(),
            amount: 5 * XLM
        }
        .to_xdr(&f.e, &f.tab)]
    );
    assert_eq!(f.balance(&reader), wallet + 5 * XLM);
    assert_eq!(f.balance(&f.tab), 0);
    assert_eq!(
        f.client().account(&reader).unwrap(),
        crate::ReaderAccount {
            balance: 0,
            next_key_id: 1,
            withdraw_unlock: 0
        }
    );
    // Nothing left: start is refused.
    f.auth(&reader, "withdraw_start", (reader.clone(),).into_val(&f.e));
    crate::assert_tab_err!(
        f.client().try_withdraw_start(&reader),
        TabError::NothingToWithdraw
    );
}

#[test]
fn withdrawal_errors_and_auth() {
    let f = Fixture::new();
    let stranger = Address::generate(&f.e);
    f.auth(
        &stranger,
        "withdraw_start",
        (stranger.clone(),).into_val(&f.e),
    );
    crate::assert_tab_err!(
        f.client().try_withdraw_start(&stranger),
        TabError::NothingToWithdraw
    );
    f.auth(&stranger, "withdraw", (stranger.clone(),).into_val(&f.e));
    crate::assert_tab_err!(
        f.client().try_withdraw(&stranger),
        TabError::NoWithdrawPending
    );
    let (reader, _, _) = f.reader(2 * XLM, XLM);
    f.auth(&reader, "withdraw", (reader.clone(),).into_val(&f.e));
    crate::assert_tab_err!(
        f.client().try_withdraw(&reader),
        TabError::NoWithdrawPending
    );
    // Someone else cannot start or finish a reader's withdrawal (I-16).
    f.auth(
        &stranger,
        "withdraw_start",
        (reader.clone(),).into_val(&f.e),
    );
    assert!(f.client().try_withdraw_start(&reader).is_err());
    f.withdraw_start(&reader);
    f.advance(WITHDRAW_DELAY);
    f.auth(&stranger, "withdraw", (reader.clone(),).into_val(&f.e));
    assert!(f.client().try_withdraw(&reader).is_err());
}

#[test]
fn deposit_cancels_a_pending_withdrawal() {
    let f = Fixture::new();
    let (reader, _, _) = f.reader(2 * XLM, XLM);
    f.withdraw_start(&reader);
    f.deposit(&reader, XLM);
    assert_eq!(
        f.tab_events(),
        std::vec![
            WithdrawCancelled {
                reader: reader.clone(),
                balance: 3 * XLM
            }
            .to_xdr(&f.e, &f.tab),
            Deposited {
                reader: reader.clone(),
                amount: XLM,
                balance_after: 3 * XLM
            }
            .to_xdr(&f.e, &f.tab),
        ]
    );
    assert_eq!(f.client().account(&reader).unwrap().withdraw_unlock, 0);
}

#[test]
fn ttl_policy_for_every_entry() {
    // I-25: instance and persistent entries reach TTL_EXTEND_TO on write.
    // I-29: Session and Paid stay live until valid_until + SETTLE_GRACE, and
    // revocation does not shorten their TTL.
    let f = Fixture::new();
    let (reader, key, key_id) = f.reader(10 * XLM, 10 * XLM);
    let w = Address::generate(&f.e);
    f.settle(&vec1(&f.e, f.voucher(&reader, &w, key_id, &key, XLM)));
    let valid_until = f
        .client()
        .session_key(&reader, &key_id)
        .unwrap()
        .valid_until;
    let deadline = valid_until + SETTLE_GRACE;
    let ttls = |f: &Fixture| {
        f.e.as_contract(&f.tab, || {
            (
                f.e.storage().instance().get_ttl(),
                f.e.storage()
                    .persistent()
                    .get_ttl(&TabKey::Account(reader.clone())),
                f.e.storage()
                    .persistent()
                    .get_ttl(&TabKey::Claimable(w.clone())),
                f.e.storage()
                    .persistent()
                    .get_ttl(&TabKey::Claimable(f.treasury.clone())),
                f.e.storage()
                    .temporary()
                    .get_ttl(&TabKey::Session(reader.clone(), key_id)),
                f.e.storage()
                    .temporary()
                    .get_ttl(&TabKey::Paid(reader.clone(), key_id, w.clone())),
            )
        })
    };
    let (inst, acct, wc, tc, sess, paid) = ttls(&f);
    assert!(inst >= TTL_THRESHOLD);
    assert_eq!(
        (acct, wc, tc),
        (TTL_EXTEND_TO, TTL_EXTEND_TO, TTL_EXTEND_TO)
    );
    assert!(f.now() + sess >= deadline && f.now() + paid >= deadline);
    // Revoke: TTLs stay; they still cover the original deadline.
    f.auth(
        &reader,
        "revoke_key",
        (reader.clone(), key_id).into_val(&f.e),
    );
    f.client().revoke_key(&reader, &key_id);
    let (_, _, _, _, sess2, paid2) = ttls(&f);
    assert!(f.now() + sess2 >= deadline && f.now() + paid2 >= deadline);
    // Past the testnet minimum persistent TTL (7 days) the account is still live.
    f.advance(120_960 + 1);
    assert_eq!(f.client().account(&reader).unwrap().balance, 10 * XLM - XLM);
}
