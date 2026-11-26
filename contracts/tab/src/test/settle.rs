//! `settle`, `settle_own` and `claim`.
use super::*;
use crate::events::{Claimed, TabSettled, VoucherSkipped};
use crate::{
    TabError, SETTLE_GRACE, SKIP_KEY_EXPIRED, SKIP_KEY_UNKNOWN, SKIP_NOT_ACCEPTED, SKIP_SHORTFALL,
    SKIP_STALE,
};
use quilltip_shared::fee::{fee, tab_fee};
use soroban_sdk::Event as _;

fn writer(f: &Fixture) -> Address {
    Address::generate(&f.e)
}

fn vecn(e: &Env, items: &[Voucher]) -> Vec<Voucher> {
    let mut out = Vec::new(e);
    for v in items {
        out.push_back(v.clone());
    }
    out
}

/// Everything a settlement can change, for "nothing changed" assertions.
fn state(
    f: &Fixture,
    reader: &Address,
    key_id: u32,
    writer: &Address,
) -> (i128, i128, i128, i128, i128) {
    let c = f.client();
    (
        c.account(reader).unwrap().balance,
        c.paid(reader, &key_id, writer),
        c.claimable(writer),
        c.claimable(&f.treasury),
        c.session_key(reader, &key_id).unwrap().spent,
    )
}

#[test]
fn settles_one_voucher_with_split_and_event() {
    // I-13, I-31, I-10: gross moves from the reader to writer net and treasury fee.
    let f = Fixture::new();
    let (reader, key, key_id) = f.reader(10 * XLM, 10 * XLM);
    let w = writer(&f);
    let v = f.voucher(&reader, &w, key_id, &key, 4 * XLM);
    let out = f.settle(&vec1(&f.e, v.clone()));
    let fee_paid = fee(4 * XLM).unwrap();
    assert_eq!(fee_paid, 1_000_000);
    assert_eq!(
        out,
        crate::SettleSummary {
            settled: 1,
            skipped: 0,
            gross: 4 * XLM,
            fee: fee_paid
        }
    );
    assert_eq!(
        f.tab_events(),
        std::vec![TabSettled {
            reader: reader.clone(),
            writer: w.clone(),
            key_id,
            cumulative: 4 * XLM,
            paid_after: 4 * XLM,
            gross: 4 * XLM,
            fee: fee_paid,
            receipts_root: v.receipts_root.clone(),
            by_writer: false,
        }
        .to_xdr(&f.e, &f.tab)]
    );
    assert_eq!(
        state(&f, &reader, key_id, &w),
        (6 * XLM, 4 * XLM, 4 * XLM - fee_paid, fee_paid, 4 * XLM)
    );
    // I-10: the token balance held by the Tab equals balances plus claimable.
    assert_eq!(
        f.balance(&f.tab),
        f.ledger_sum(&[reader], &[w, f.treasury.clone()])
    );
}

#[test]
fn cumulative_must_increase() {
    // I-11: an equal or lower cumulative is STALE; a higher one pays only the increase.
    let f = Fixture::new();
    let (reader, key, key_id) = f.reader(10 * XLM, 10 * XLM);
    let w = writer(&f);
    f.settle(&vec1(&f.e, f.voucher(&reader, &w, key_id, &key, 3 * XLM)));
    for c in [3 * XLM, 2 * XLM, 1, 0, -5] {
        let v = f.voucher(&reader, &w, key_id, &key, c);
        assert_eq!(
            f.try_settle(&vec1(&f.e, v)),
            summary(0, 1, 0, 0),
            "cumulative {c}"
        );
        assert_eq!(
            f.tab_events(),
            std::vec![VoucherSkipped {
                reader: reader.clone(),
                writer: w.clone(),
                key_id,
                cumulative: c,
                reason: SKIP_STALE
            }
            .to_xdr(&f.e, &f.tab)]
        );
    }
    let out = f.settle(&vec1(
        &f.e,
        f.voucher(&reader, &w, key_id, &key, 3 * XLM + 41),
    ));
    assert_eq!((out.gross, out.fee), (41, tab_fee(3 * XLM, 41).unwrap()));
    assert_eq!(f.client().paid(&reader, &key_id, &w), 3 * XLM + 41);
}

#[test]
fn unknown_key_is_skipped() {
    let f = Fixture::new();
    let (reader, key, _) = f.reader(5 * XLM, 5 * XLM);
    let w = writer(&f);
    let v = f.voucher(&reader, &w, 9, &key, XLM);
    assert_eq!(f.try_settle(&vec1(&f.e, v)), summary(0, 1, 0, 0));
    assert_eq!(
        f.tab_events(),
        std::vec![VoucherSkipped {
            reader,
            writer: w,
            key_id: 9,
            cumulative: XLM,
            reason: SKIP_KEY_UNKNOWN
        }
        .to_xdr(&f.e, &f.tab)]
    );
}

#[test]
fn settle_window_boundaries() {
    // I-15, I-29: a voucher settles up to and including valid_until + SETTLE_GRACE, never after.
    let f = Fixture::new();
    let (reader, key, key_id) = f.reader(10 * XLM, 10 * XLM);
    let w = writer(&f);
    let valid_until = f
        .client()
        .session_key(&reader, &key_id)
        .unwrap()
        .valid_until;
    let deadline = valid_until + SETTLE_GRACE;
    // Inside the grace period after valid_until.
    f.e.ledger().set_sequence_number(valid_until + 1);
    assert_eq!(
        f.try_settle(&vec1(&f.e, f.voucher(&reader, &w, key_id, &key, XLM))),
        summary(1, 0, XLM, fee(XLM).unwrap())
    );
    // Last ledger of the window.
    f.e.ledger().set_sequence_number(deadline);
    let out = f.try_settle(&vec1(&f.e, f.voucher(&reader, &w, key_id, &key, 2 * XLM)));
    assert_eq!(out, summary(1, 0, XLM, tab_fee(XLM, XLM).unwrap()));
    // I-29: Paid is still readable at the deadline.
    assert_eq!(f.client().paid(&reader, &key_id, &w), 2 * XLM);
    // One ledger later the key and its Paid entries are gone: skipped, not paid.
    f.e.ledger().set_sequence_number(deadline + 1);
    let out = f.try_settle(&vec1(&f.e, f.voucher(&reader, &w, key_id, &key, 3 * XLM)));
    assert_eq!(out, summary(0, 1, 0, 0));
    assert_eq!(f.client().account(&reader).unwrap().balance, 8 * XLM);
}

#[test]
fn expired_check_applies_while_the_entry_is_live() {
    // I-15: a key whose Session entry outlives its window (TTLs never shrink) is
    // refused by the explicit window check, reason KEY_EXPIRED.
    let f = Fixture::new();
    let (reader, key, key_id) = f.reader(10 * XLM, 10 * XLM);
    let w = writer(&f);
    // Settle once so the window is fixed, then revoke: valid_until drops to now,
    // but the Session TTL keeps the original (longer) lifetime.
    f.settle(&vec1(&f.e, f.voucher(&reader, &w, key_id, &key, XLM)));
    f.auth(
        &reader,
        "revoke_key",
        (reader.clone(), key_id).into_val(&f.e),
    );
    f.client().revoke_key(&reader, &key_id);
    let revoked_until = f
        .client()
        .session_key(&reader, &key_id)
        .unwrap()
        .valid_until;
    assert_eq!(revoked_until, f.now());
    f.e.ledger()
        .set_sequence_number(revoked_until + SETTLE_GRACE + 1);
    let v = f.voucher(&reader, &w, key_id, &key, 2 * XLM);
    assert_eq!(f.try_settle(&vec1(&f.e, v)), summary(0, 1, 0, 0));
    assert_eq!(
        f.tab_events(),
        std::vec![VoucherSkipped {
            reader,
            writer: w,
            key_id,
            cumulative: 2 * XLM,
            reason: SKIP_KEY_EXPIRED
        }
        .to_xdr(&f.e, &f.tab)]
    );
}

#[test]
fn revoked_key_settles_accepted_vouchers_within_grace() {
    // Revocation lowers valid_until to now; the settler still has SETTLE_GRACE.
    let f = Fixture::new();
    let (reader, key, key_id) = f.reader(10 * XLM, 10 * XLM);
    let w = writer(&f);
    let v = f.voucher(&reader, &w, key_id, &key, XLM);
    f.auth(
        &reader,
        "revoke_key",
        (reader.clone(), key_id).into_val(&f.e),
    );
    f.client().revoke_key(&reader, &key_id);
    f.advance(SETTLE_GRACE);
    assert_eq!(
        f.try_settle(&vec1(&f.e, v)),
        summary(1, 0, XLM, fee(XLM).unwrap())
    );
}

#[test]
fn replay_is_refused_across_domains() {
    // I-14: a signature binds network, contract, reader, writer, key ID and public key.
    let f = Fixture::new();
    let (reader, key, key_id) = f.reader(10 * XLM, 10 * XLM);
    let (other_reader, _, _) = f.reader(10 * XLM, 10 * XLM);
    let w = writer(&f);
    let w2 = writer(&f);
    let other_tab = Address::generate(&f.e);
    let r = root(&f.e, 7);
    let sign_for = |tab: &Address, net: [u8; 32], rd: &Address, wr: &Address, kid: u32| {
        f.sign(&key, &f.payload_for(tab, net, rd, wr, kid, &key, XLM, &r))
    };
    let voucher = |rd: &Address, wr: &Address, kid: u32, sig: BytesN<64>| Voucher {
        reader: rd.clone(),
        writer: wr.clone(),
        key_id: kid,
        cumulative: XLM,
        receipts_root: r.clone(),
        signature: sig,
        acceptor: None,
        acceptance_signature: None,
    };
    let mut mainnet_id = TESTNET_NETWORK_ID;
    mainnet_id[0] ^= 0xff;
    let cases = [
        (
            "other network",
            voucher(
                &reader,
                &w,
                key_id,
                sign_for(&f.tab, mainnet_id, &reader, &w, key_id),
            ),
        ),
        (
            "other contract",
            voucher(
                &reader,
                &w,
                key_id,
                sign_for(&other_tab, TESTNET_NETWORK_ID, &reader, &w, key_id),
            ),
        ),
        (
            "other reader",
            voucher(
                &other_reader,
                &w,
                0,
                sign_for(&f.tab, TESTNET_NETWORK_ID, &reader, &w, 0),
            ),
        ),
        (
            "other writer",
            voucher(
                &reader,
                &w2,
                key_id,
                sign_for(&f.tab, TESTNET_NETWORK_ID, &reader, &w, key_id),
            ),
        ),
        (
            "other root",
            Voucher {
                receipts_root: root(&f.e, 8),
                ..voucher(
                    &reader,
                    &w,
                    key_id,
                    sign_for(&f.tab, TESTNET_NETWORK_ID, &reader, &w, key_id),
                )
            },
        ),
        (
            "other amount",
            Voucher {
                cumulative: 2 * XLM,
                ..voucher(
                    &reader,
                    &w,
                    key_id,
                    sign_for(&f.tab, TESTNET_NETWORK_ID, &reader, &w, key_id),
                )
            },
        ),
    ];
    for (name, v) in cases {
        let before = f.ledger_sum(
            &[reader.clone(), other_reader.clone()],
            &[w.clone(), w2.clone(), f.treasury.clone()],
        );
        assert_eq!(f.try_settle(&vec1(&f.e, v)), Outcome::Aborted, "{name}");
        let after = f.ledger_sum(
            &[reader.clone(), other_reader.clone()],
            &[w.clone(), w2.clone(), f.treasury.clone()],
        );
        assert_eq!(before, after, "{name}");
        assert_eq!(f.client().claimable(&w), 0, "{name}");
    }
    // The correctly signed voucher still settles.
    let good = voucher(
        &reader,
        &w,
        key_id,
        sign_for(&f.tab, TESTNET_NETWORK_ID, &reader, &w, key_id),
    );
    assert_eq!(
        f.try_settle(&vec1(&f.e, good)),
        summary(1, 0, XLM, fee(XLM).unwrap())
    );
}

#[test]
fn rotated_keys_have_separate_counters_and_signatures() {
    // I-14, I-28: key IDs are never reused; a voucher for key 0 does not verify
    // under key 1, and counters restart at 0 for the new key.
    let f = Fixture::new();
    let (reader, key0, k0) = f.reader(10 * XLM, 10 * XLM);
    let w = writer(&f);
    f.settle(&vec1(&f.e, f.voucher(&reader, &w, k0, &key0, 3 * XLM)));
    let key1 = signing_key("rotated-key");
    let k1 = f.open_session(&reader, 0, &key1, f.now() + 1_000, 10 * XLM);
    assert_eq!((k0, k1), (0, 1));
    // Old key's signature presented as key 1: refused.
    let mut forged = f.voucher(&reader, &w, k0, &key0, 4 * XLM);
    forged.key_id = k1;
    assert_eq!(f.try_settle(&vec1(&f.e, forged)), Outcome::Aborted);
    // Key 1 starts from zero: 1 XLM pays 1 XLM, not 1 - 3.
    let out = f.settle(&vec1(&f.e, f.voucher(&reader, &w, k1, &key1, XLM)));
    assert_eq!(out.gross, XLM);
    // Key 0 keeps its own counter.
    let out = f.settle(&vec1(&f.e, f.voucher(&reader, &w, k0, &key0, 4 * XLM)));
    assert_eq!(out.gross, XLM);
    assert_eq!(f.client().account(&reader).unwrap().balance, 5 * XLM);
}

#[test]
fn one_bad_signature_aborts_the_whole_batch() {
    // Section 3.2 abort conditions: an invalid signature traps; nothing in the batch settles.
    let f = Fixture::new();
    let (reader, key, key_id) = f.reader(10 * XLM, 10 * XLM);
    let w = writer(&f);
    let good1 = f.voucher(&reader, &w, key_id, &key, XLM);
    let mut bad = f.voucher(&reader, &w, key_id, &key, 2 * XLM);
    bad.signature = f.sign(
        &signing_key("not-the-reader"),
        &soroban_sdk::Bytes::from_array(&f.e, &[1, 2, 3]),
    );
    let good2 = f.voucher(&reader, &w, key_id, &key, 3 * XLM);
    let before = state(&f, &reader, key_id, &w);
    assert_eq!(
        f.try_settle(&vecn(&f.e, &[good1.clone(), bad, good2.clone()])),
        Outcome::Aborted
    );
    assert_eq!(state(&f, &reader, key_id, &w), before);
    // Without the bad voucher both settle; the second pays only its increase.
    assert_eq!(
        f.try_settle(&vecn(&f.e, &[good1, good2])),
        summary(2, 0, 3 * XLM, fee(3 * XLM).unwrap())
    );
}

#[test]
fn duplicate_pair_in_one_batch() {
    // I-11: the second voucher for the same pair settles only if its cumulative is higher.
    let f = Fixture::new();
    let (reader, key, key_id) = f.reader(10 * XLM, 10 * XLM);
    let w = writer(&f);
    let a = f.voucher(&reader, &w, key_id, &key, 2 * XLM);
    let b = f.voucher(&reader, &w, key_id, &key, 2 * XLM);
    let c = f.voucher(&reader, &w, key_id, &key, 5 * XLM);
    assert_eq!(
        f.try_settle(&vecn(&f.e, &[a, b, c])),
        summary(2, 1, 5 * XLM, fee(5 * XLM).unwrap())
    );
}

#[test]
fn short_balance_pays_what_is_available_and_the_rest_later() {
    // I-12: gross <= balance; the same voucher collects the rest after a deposit.
    let f = Fixture::new();
    let (reader, key, key_id) = f.reader(2 * XLM, 10 * XLM);
    let w = writer(&f);
    let v = f.voucher(&reader, &w, key_id, &key, 5 * XLM);
    let out = f.settle(&vec1(&f.e, v.clone()));
    assert_eq!((out.settled, out.gross), (1, 2 * XLM));
    assert_eq!(f.client().account(&reader).unwrap().balance, 0);
    // Balance zero: nothing payable, SHORTFALL.
    assert_eq!(f.try_settle(&vec1(&f.e, v.clone())), summary(0, 1, 0, 0));
    assert_eq!(
        f.tab_events(),
        std::vec![VoucherSkipped {
            reader: reader.clone(),
            writer: w.clone(),
            key_id,
            cumulative: 5 * XLM,
            reason: SKIP_SHORTFALL
        }
        .to_xdr(&f.e, &f.tab)]
    );
    f.deposit(&reader, 4 * XLM);
    let out = f.settle(&vec1(&f.e, v));
    assert_eq!(out.gross, 3 * XLM);
    assert_eq!(f.client().paid(&reader, &key_id, &w), 5 * XLM);
    assert_eq!(f.client().account(&reader).unwrap().balance, XLM);
    // I-31: two partial settlements charged the fee of the total.
    assert_eq!(f.client().claimable(&f.treasury), fee(5 * XLM).unwrap());
}

#[test]
fn spend_limit_caps_each_key() {
    // I-12: gross <= spend_limit - spent, across all writers of the key.
    let f = Fixture::new();
    let (reader, key, key_id) = f.reader(10 * XLM, 3 * XLM);
    let (w1, w2) = (writer(&f), writer(&f));
    let out = f.settle(&vecn(
        &f.e,
        &[
            f.voucher(&reader, &w1, key_id, &key, 2 * XLM),
            f.voucher(&reader, &w2, key_id, &key, 2 * XLM),
        ],
    ));
    assert_eq!((out.settled, out.gross), (2, 3 * XLM));
    assert_eq!(
        f.client().session_key(&reader, &key_id).unwrap().spent,
        3 * XLM
    );
    assert_eq!(
        f.try_settle(&vec1(&f.e, f.voucher(&reader, &w2, key_id, &key, 3 * XLM))),
        summary(0, 1, 0, 0)
    );
}

#[test]
fn settlement_and_withdrawal_in_every_order() {
    // I-16, I-12, I-10: whatever the order, the reader receives exactly the
    // balance left after settlement, and nothing is paid twice.
    let orders: [&str; 4] = [
        "settle-start-withdraw",
        "start-settle-withdraw",
        "start-withdraw-settle",
        "start-settle-at-unlock-withdraw",
    ];
    for order in orders {
        let f = Fixture::new();
        let (reader, key, key_id) = f.reader(10 * XLM, 10 * XLM);
        let w = writer(&f);
        let v = f.voucher(&reader, &w, key_id, &key, 4 * XLM);
        let wallet_before = f.balance(&reader);
        let start = |f: &Fixture| f.withdraw_start(&reader);
        let unlock = |f: &Fixture| f.advance(crate::WITHDRAW_DELAY);
        let (settled, withdrawn) = match order {
            "settle-start-withdraw" => {
                let s = f.settle(&vec1(&f.e, v.clone())).gross;
                start(&f);
                unlock(&f);
                (s, f.withdraw(&reader))
            }
            "start-settle-withdraw" => {
                start(&f);
                let s = f.settle(&vec1(&f.e, v.clone())).gross;
                unlock(&f);
                (s, f.withdraw(&reader))
            }
            "start-withdraw-settle" => {
                start(&f);
                unlock(&f);
                let w_out = f.withdraw(&reader);
                let out = f.try_settle(&vec1(&f.e, v.clone()));
                assert_eq!(out, summary(0, 1, 0, 0), "{order}");
                (0, w_out)
            }
            "start-settle-at-unlock-withdraw" => {
                start(&f);
                unlock(&f);
                let s = f.settle(&vec1(&f.e, v.clone())).gross;
                (s, f.withdraw(&reader))
            }
            _ => unreachable!(),
        };
        assert_eq!(settled + withdrawn, 10 * XLM, "{order}");
        assert_eq!(f.balance(&reader), wallet_before + withdrawn, "{order}");
        assert_eq!(f.client().account(&reader).unwrap().balance, 0, "{order}");
        assert_eq!(
            f.balance(&f.tab),
            f.ledger_sum(
                core::slice::from_ref(&reader),
                &[w.clone(), f.treasury.clone()]
            ),
            "{order}"
        );
        // A second withdrawal is refused (I-16).
        f.auth(&reader, "withdraw", (reader.clone(),).into_val(&f.e));
        crate::assert_tab_err!(
            f.client().try_withdraw(&reader),
            TabError::NoWithdrawPending
        );
    }
}

#[test]
fn many_small_deltas_charge_the_same_fee_as_one_large() {
    // I-31: 100 settlements of 39 stroops charge fee(3,900) = 97, like one settlement.
    let small = Fixture::quiet();
    let (r1, k1, id1) = small.reader(10 * XLM, 10 * XLM);
    let w1 = writer(&small);
    for i in 1..=100 {
        small.settle(&vec1(&small.e, small.voucher(&r1, &w1, id1, &k1, 39 * i)));
    }
    let large = Fixture::quiet();
    let (r2, k2, id2) = large.reader(10 * XLM, 10 * XLM);
    let w2 = writer(&large);
    large.settle(&vec1(&large.e, large.voucher(&r2, &w2, id2, &k2, 3_900)));
    assert_eq!(small.client().claimable(&small.treasury), 97);
    assert_eq!(large.client().claimable(&large.treasury), 97);
    assert_eq!(small.client().claimable(&w1), 3_900 - 97);
    assert_eq!(large.client().claimable(&w2), 3_900 - 97);
}

#[test]
fn settle_own_requires_a_valid_acceptance() {
    // I-18: settle_own pays only countersigned vouchers of the calling writer.
    let f = Fixture::new();
    let (reader, key, key_id) = f.reader(10 * XLM, 10 * XLM);
    let w = writer(&f);
    let plain = f.voucher(&reader, &w, key_id, &key, XLM);
    // No acceptance: skipped.
    assert_eq!(
        f.try_settle_own(&w, &vec1(&f.e, plain.clone())),
        summary(0, 1, 0, 0)
    );
    assert_eq!(
        f.tab_events(),
        std::vec![VoucherSkipped {
            reader: reader.clone(),
            writer: w.clone(),
            key_id,
            cumulative: XLM,
            reason: SKIP_NOT_ACCEPTED
        }
        .to_xdr(&f.e, &f.tab)]
    );
    // Unknown acceptor key: skipped.
    let stranger = signing_key("stranger-acceptor");
    assert_eq!(
        f.try_settle_own(&w, &vec1(&f.e, f.accept(&plain, &key, &stranger))),
        summary(0, 1, 0, 0)
    );
    // Known key, signature over other bytes: aborts.
    let mut forged = f.accept(&plain, &key, &f.acceptor);
    forged.acceptance_signature = f
        .accept(
            &f.voucher(&reader, &w, key_id, &key, 2 * XLM),
            &key,
            &f.acceptor,
        )
        .acceptance_signature;
    assert_eq!(f.try_settle_own(&w, &vec1(&f.e, forged)), Outcome::Aborted);
    // Only one of the two acceptance fields: skipped.
    let mut half = f.accept(&plain, &key, &f.acceptor);
    half.acceptance_signature = None;
    assert_eq!(f.try_settle_own(&w, &vec1(&f.e, half)), summary(0, 1, 0, 0));
    // Valid: settles with by_writer = true.
    let ok = f.accept(&plain, &key, &f.acceptor);
    assert_eq!(
        f.try_settle_own(&w, &vec1(&f.e, ok.clone())),
        summary(1, 0, XLM, fee(XLM).unwrap())
    );
    assert_eq!(
        f.tab_events(),
        std::vec![TabSettled {
            reader: reader.clone(),
            writer: w.clone(),
            key_id,
            cumulative: XLM,
            paid_after: XLM,
            gross: XLM,
            fee: fee(XLM).unwrap(),
            receipts_root: ok.receipts_root.clone(),
            by_writer: true,
        }
        .to_xdr(&f.e, &f.tab)]
    );
}

#[test]
fn settle_own_rejects_other_writers_and_needs_writer_auth() {
    let f = Fixture::new();
    let (reader, key, key_id) = f.reader(10 * XLM, 10 * XLM);
    let (w, other) = (writer(&f), writer(&f));
    let mine = f.accept(
        &f.voucher(&reader, &w, key_id, &key, XLM),
        &key,
        &f.acceptor,
    );
    let theirs = f.accept(
        &f.voucher(&reader, &other, key_id, &key, XLM),
        &key,
        &f.acceptor,
    );
    assert_eq!(
        f.try_settle_own(&w, &vecn(&f.e, &[mine.clone(), theirs])),
        Outcome::Tab(TabError::WrongWriter)
    );
    // Signed by someone else than the writer: refused.
    f.auth(
        &other,
        "settle_own",
        (w.clone(), vec1(&f.e, mine.clone())).into_val(&f.e),
    );
    assert!(f.client().try_settle_own(&w, &vec1(&f.e, mine)).is_err());
}

#[test]
fn acceptor_rotation_keeps_the_previous_key() {
    // Section 5.11: set_acceptor keeps [new, previous]; a second call drops the old key.
    let f = Fixture::new();
    let (reader, key, key_id) = f.reader(10 * XLM, 10 * XLM);
    let w = writer(&f);
    let old = f.accept(
        &f.voucher(&reader, &w, key_id, &key, XLM),
        &key,
        &f.acceptor,
    );
    let new_key = signing_key("acceptor-2");
    let set = |k: &SigningKey| {
        let pk = public_key(&f.e, k);
        f.auth(&f.admin, "set_acceptor", (pk.clone(),).into_val(&f.e));
        f.client().set_acceptor(&pk);
    };
    set(&new_key);
    assert_eq!(
        f.try_settle_own(&w, &vec1(&f.e, old)),
        summary(1, 0, XLM, fee(XLM).unwrap())
    );
    set(&new_key);
    let older = f.accept(
        &f.voucher(&reader, &w, key_id, &key, 2 * XLM),
        &key,
        &f.acceptor,
    );
    assert_eq!(
        f.try_settle_own(&w, &vec1(&f.e, older)),
        summary(0, 1, 0, 0)
    );
    let current = f.accept(
        &f.voucher(&reader, &w, key_id, &key, 2 * XLM),
        &key,
        &new_key,
    );
    assert_eq!(
        f.try_settle_own(&w, &vec1(&f.e, current)),
        summary(1, 0, XLM, tab_fee(XLM, XLM).unwrap())
    );
}

#[test]
fn batch_size_limits() {
    let f = Fixture::new();
    let (reader, key, key_id) = f.reader(10 * XLM, 10 * XLM);
    let w = writer(&f);
    assert_eq!(
        f.try_settle(&Vec::new(&f.e)),
        Outcome::Tab(TabError::BatchEmpty)
    );
    let mut many = Vec::new(&f.e);
    for i in 1..=(crate::MAX_SETTLE_BATCH + 1) {
        many.push_back(f.voucher(&reader, &w, key_id, &key, i as i128));
    }
    assert_eq!(f.try_settle(&many), Outcome::Tab(TabError::BatchTooLarge));
    assert_eq!(
        f.try_settle_own(&w, &Vec::new(&f.e)),
        Outcome::Tab(TabError::BatchEmpty)
    );
    many.pop_back();
    assert_eq!(
        f.try_settle(&many),
        summary(crate::MAX_SETTLE_BATCH, 0, 32, 0)
    );
}

#[test]
fn only_the_settler_role_can_settle() {
    // I-26: settle needs the settler role and the settler's own authorisation.
    let f = Fixture::new();
    let (reader, key, key_id) = f.reader(10 * XLM, 10 * XLM);
    let w = writer(&f);
    let vs = vec1(&f.e, f.voucher(&reader, &w, key_id, &key, XLM));
    f.auth(&w, "settle", (w.clone(), vs.clone()).into_val(&f.e));
    assert!(f.client().try_settle(&w, &vs).is_err());
    f.auth(
        &f.admin,
        "settle",
        (f.settler.clone(), vs.clone()).into_val(&f.e),
    );
    assert!(f.client().try_settle(&f.settler, &vs).is_err());
}

#[test]
fn account_missing_is_an_error() {
    // I-28 guard: a session without its account fails with AccountMissing.
    let f = Fixture::new();
    let reader = Address::generate(&f.e);
    let key = signing_key("orphan");
    let w = writer(&f);
    f.e.as_contract(&f.tab, || {
        crate::storage::set_session(
            &f.e,
            &reader,
            0,
            &crate::SessionKey {
                public_key: public_key(&f.e, &key),
                valid_until: f.now() + 100,
                spend_limit: XLM,
                spent: 0,
                revoked: false,
            },
        );
    });
    let v = f.voucher(&reader, &w, 0, &key, XLM);
    assert_eq!(
        f.try_settle(&vec1(&f.e, v)),
        Outcome::Tab(TabError::AccountMissing)
    );
}

#[test]
fn claim_pays_exactly_once_to_the_recipient() {
    // I-17: claim pays the claimable amount to the recipient only, then zero.
    let f = Fixture::new();
    let (reader, key, key_id) = f.reader(10 * XLM, 10 * XLM);
    let w = writer(&f);
    f.settle(&vec1(&f.e, f.voucher(&reader, &w, key_id, &key, 4 * XLM)));
    let owed = f.client().claimable(&w);
    assert_eq!(f.claim(&w), owed);
    assert_eq!(
        f.tab_events(),
        std::vec![Claimed {
            recipient: w.clone(),
            amount: owed
        }
        .to_xdr(&f.e, &f.tab)]
    );
    assert_eq!(f.balance(&w), owed);
    assert_eq!(f.client().claimable(&w), 0);
    assert_eq!(f.claim(&w), 0);
    assert!(f.tab_events().is_empty());
    let fee_owed = f.client().claimable(&f.treasury);
    assert_eq!(f.claim(&f.treasury), fee_owed);
    assert_eq!(f.balance(&f.treasury), fee_owed);
    assert_eq!(
        f.balance(&f.tab),
        f.client().account(&reader).unwrap().balance
    );
}

#[test]
fn treasury_change_redirects_new_fees_only() {
    let f = Fixture::new();
    let (reader, key, key_id) = f.reader(10 * XLM, 10 * XLM);
    let w = writer(&f);
    f.settle(&vec1(&f.e, f.voucher(&reader, &w, key_id, &key, XLM)));
    let new_treasury = Address::generate(&f.e);
    f.auth(
        &f.admin,
        "set_treasury",
        (new_treasury.clone(),).into_val(&f.e),
    );
    f.client().set_treasury(&new_treasury);
    f.settle(&vec1(&f.e, f.voucher(&reader, &w, key_id, &key, 2 * XLM)));
    assert_eq!(f.client().claimable(&f.treasury), fee(XLM).unwrap());
    assert_eq!(
        f.client().claimable(&new_treasury),
        tab_fee(XLM, XLM).unwrap()
    );
}
