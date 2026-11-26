//! Property tests. Fixtures here write no snapshots.
#![allow(clippy::needless_range_loop)]
//!
//! - `conservation_holds_for_any_sequence`: I-10, I-11, I-12, I-13, I-16, I-17, I-31.
//!   After every step: deposits = Σ reader balances + Σ claimable + claimed + withdrawn,
//!   and the Tab's token balance = Σ reader balances + Σ claimable.
//! - `random_vouchers_never_pay`: I-14. Vouchers with random fields or signatures
//!   either abort or are skipped; they never move funds.
use super::*;
use proptest::prelude::*;
use quilltip_shared::fee::fee;
use quilltip_shared::DAY;

const READERS: usize = 3;
const WRITERS: usize = 3;

#[derive(Clone, Debug)]
enum Op {
    Deposit(usize, i128),
    Sign(usize, usize, i128),
    Settle(u8, bool),
    Claim(usize),
    WithdrawStart(usize),
    Withdraw(usize),
    Advance(u32),
}

fn op() -> impl Strategy<Value = Op> {
    prop_oneof![
        (0..READERS, MIN_DEPOSIT..=5 * XLM).prop_map(|(r, a)| Op::Deposit(r, a)),
        (0..READERS, 0..WRITERS, 1i128..=3 * XLM).prop_map(|(r, w, a)| Op::Sign(r, w, a)),
        (any::<u8>(), any::<bool>()).prop_map(|(m, own)| Op::Settle(m, own)),
        (0..=WRITERS).prop_map(Op::Claim),
        (0..READERS).prop_map(Op::WithdrawStart),
        (0..READERS).prop_map(Op::Withdraw),
        (0u32..=DAY).prop_map(Op::Advance),
    ]
}

struct Model {
    f: Fixture,
    readers: std::vec::Vec<Address>,
    keys: std::vec::Vec<ed25519_dalek::SigningKey>,
    writers: std::vec::Vec<Address>,
    signed: [[i128; WRITERS]; READERS],
    deposits: i128,
    claimed: i128,
    withdrawn: i128,
    last_paid: [[i128; WRITERS]; READERS],
}

impl Model {
    fn new() -> Self {
        let f = Fixture::quiet();
        let mut readers = std::vec::Vec::new();
        let mut keys = std::vec::Vec::new();
        for i in 0..READERS {
            let r = Address::generate(&f.e);
            f.mint(&r, MAX_BALANCE * 2);
            let k = signing_key(&std::format!("prop-reader-{i}"));
            // Limit below the possible deposits so the spend limit binds sometimes (I-12).
            f.open_session(&r, 0, &k, f.now() + crate::MAX_KEY_LIFETIME, 12 * XLM);
            readers.push(r);
            keys.push(k);
        }
        let writers = (0..WRITERS).map(|_| Address::generate(&f.e)).collect();
        Model {
            f,
            readers,
            keys,
            writers,
            signed: [[0; WRITERS]; READERS],
            deposits: 0,
            claimed: 0,
            withdrawn: 0,
            last_paid: [[0; WRITERS]; READERS],
        }
    }

    fn payees(&self) -> std::vec::Vec<Address> {
        let mut p = self.writers.clone();
        p.push(self.f.treasury.clone());
        p
    }

    fn apply(&mut self, op: &Op) {
        let f = &self.f;
        let c = f.client();
        match *op {
            Op::Deposit(r, a) => {
                let reader = &self.readers[r];
                let bal = c.account(reader).map(|x| x.balance).unwrap_or(0);
                if bal + a <= MAX_BALANCE {
                    f.deposit(reader, a);
                    self.deposits += a;
                }
            }
            Op::Sign(r, w, a) => self.signed[r][w] += a,
            Op::Settle(mask, own) => {
                let mut by_writer: std::vec::Vec<Vec<Voucher>> =
                    (0..WRITERS).map(|_| Vec::new(&f.e)).collect();
                let mut all = Vec::new(&f.e);
                for r in 0..READERS {
                    for w in 0..WRITERS {
                        let bit = (r * WRITERS + w) % 8;
                        if mask & (1 << bit) == 0 || self.signed[r][w] == 0 {
                            continue;
                        }
                        let v = f.voucher(
                            &self.readers[r],
                            &self.writers[w],
                            0,
                            &self.keys[r],
                            self.signed[r][w],
                        );
                        if own {
                            by_writer[w].push_back(f.accept(&v, &self.keys[r], &f.acceptor));
                        } else {
                            all.push_back(v);
                        }
                    }
                }
                if own {
                    for (w, vs) in by_writer.iter().enumerate() {
                        if !vs.is_empty() {
                            f.settle_own(&self.writers[w], vs);
                        }
                    }
                } else if !all.is_empty() {
                    f.settle(&all);
                }
            }
            Op::Claim(i) => {
                let who = self.payees()[i].clone();
                let before = f.balance(&who);
                let got = f.claim(&who);
                assert_eq!(f.balance(&who), before + got);
                self.claimed += got;
            }
            Op::WithdrawStart(r) => {
                let reader = &self.readers[r];
                let a = c.account(reader).unwrap();
                if a.balance > 0 && a.withdraw_unlock == 0 {
                    f.withdraw_start(reader);
                }
            }
            Op::Withdraw(r) => {
                let reader = &self.readers[r];
                let a = c.account(reader).unwrap();
                if a.withdraw_unlock != 0 && f.now() >= a.withdraw_unlock {
                    let before = f.balance(reader);
                    let got = f.withdraw(reader);
                    // I-16: exactly the balance, to the reader.
                    assert_eq!(got, a.balance);
                    assert_eq!(f.balance(reader), before + got);
                    self.withdrawn += got;
                }
            }
            Op::Advance(n) => f.advance(n),
        }
    }

    fn check(&mut self) {
        let f = &self.f;
        let c = f.client();
        let payees = self.payees();
        let held = f.ledger_sum(&self.readers, &payees);
        // I-10.
        assert_eq!(f.balance(&f.tab), held);
        assert_eq!(self.deposits, held + self.claimed + self.withdrawn);
        let mut fee_total = 0;
        let mut writer_net = [0i128; WRITERS];
        for r in 0..READERS {
            let mut spent = 0;
            for w in 0..WRITERS {
                let paid = c.paid(&self.readers[r], &0, &self.writers[w]);
                // I-11: monotonic and never above the signed cumulative.
                assert!(paid >= self.last_paid[r][w] && paid <= self.signed[r][w]);
                self.last_paid[r][w] = paid;
                fee_total += fee(paid).unwrap();
                writer_net[w] += paid - fee(paid).unwrap();
                spent += paid;
            }
            // I-12: the spend limit is never exceeded.
            let key = c.session_key(&self.readers[r], &0).unwrap();
            assert_eq!(key.spent, spent);
            assert!(key.spent <= key.spend_limit);
        }
        // I-13, I-31: fees credited equal Σ floor(Paid × 250 / 10,000); writers get the rest.
        let treasury_total = c.claimable(&f.treasury) + f.balance(&f.treasury);
        assert_eq!(treasury_total, fee_total);
        for w in 0..WRITERS {
            assert_eq!(
                c.claimable(&self.writers[w]) + f.balance(&self.writers[w]),
                writer_net[w]
            );
        }
    }
}

/// 48 cases by default; set `PROPTEST_CASES` for a longer run.
fn cases() -> u32 {
    std::env::var("PROPTEST_CASES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(48)
}

proptest! {
    #![proptest_config(ProptestConfig { cases: cases(), .. ProptestConfig::default() })]

    #[test]
    fn conservation_holds_for_any_sequence(ops in proptest::collection::vec(op(), 1..40)) {
        let mut m = Model::new();
        for o in &ops {
            m.apply(o);
            m.check();
        }
    }

    #[test]
    fn random_vouchers_never_pay(
        sig in proptest::array::uniform32(any::<u8>()),
        sig2 in proptest::array::uniform32(any::<u8>()),
        key_id in 0u32..4,
        cumulative in any::<i128>(),
        root_byte in any::<u8>(),
        swap_writer in any::<bool>(),
    ) {
        let f = Fixture::quiet();
        let (reader, key, _) = f.reader(10 * XLM, 10 * XLM);
        let w = Address::generate(&f.e);
        let other = Address::generate(&f.e);
        let mut raw = [0u8; 64];
        raw[..32].copy_from_slice(&sig);
        raw[32..].copy_from_slice(&sig2);
        let v = Voucher {
            reader: reader.clone(),
            writer: if swap_writer { other.clone() } else { w.clone() },
            key_id,
            cumulative,
            receipts_root: root(&f.e, root_byte),
            signature: BytesN::from_array(&f.e, &raw),
            acceptor: Some(public_key(&f.e, &f.acceptor)),
            acceptance_signature: Some(BytesN::from_array(&f.e, &raw)),
        };
        let before = f.ledger_sum(core::slice::from_ref(&reader), &[w.clone(), other.clone(), f.treasury.clone()]);
        let out = f.try_settle(&vec1(&f.e, v.clone()));
        let paid_nothing = |o: &Outcome| matches!(o, Outcome::Aborted | Outcome::Ok(crate::SettleSummary { settled: 0, .. }));
        prop_assert!(paid_nothing(&out));
        let vw = v.writer.clone();
        let out = f.try_settle_own(&vw, &vec1(&f.e, v));
        prop_assert!(paid_nothing(&out));
        let after = f.ledger_sum(core::slice::from_ref(&reader), &[w, other, f.treasury.clone()]);
        prop_assert_eq!(before, after);
        prop_assert_eq!(f.client().account(&reader).unwrap().balance, 10 * XLM);
        let _ = key;
    }
}
