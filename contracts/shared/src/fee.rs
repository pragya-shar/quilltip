//! Fee and split arithmetic (`01-architecture.md`, section 1.5; `03-tab-contract.md`, section 3.2).
//!
//! Every function is checked and returns `None` on overflow or on an invalid
//! input. Each contract maps `None` to its own `Overflow` (or input) error.
//!
//! Rounding rules:
//! 1. `fee = floor(gross * FEE_BPS / BPS_DENOMINATOR)`.
//! 2. `net = gross - fee`.
//! 3. Co-author shares: `share_i = floor(net * bps_i / BPS_DENOMINATOR)` for every
//!    recipient after the first; the first recipient receives `net - Σ others`.
//! 4. Tab: the fee for an increment is computed on the cumulative amount paid,
//!    `fee(paid + gross) - fee(paid)`, so incremental fees always sum to the
//!    fee of the total (I-31).

use crate::constants::{BPS_DENOMINATOR, FEE_BPS};

/// `floor(amount * bps / BPS_DENOMINATOR)` for `amount >= 0` and `bps <= BPS_DENOMINATOR`.
pub fn bps_of(amount: i128, bps: u32) -> Option<i128> {
    if amount < 0 || bps > BPS_DENOMINATOR {
        return None;
    }
    amount
        .checked_mul(bps as i128)
        .map(|v| v / BPS_DENOMINATOR as i128)
}

/// Platform fee of a gross amount (`gross >= 0`).
pub fn fee(gross: i128) -> Option<i128> {
    bps_of(gross, FEE_BPS)
}

/// `(fee, net)` for a gross amount, with `fee + net == gross` (I-1).
pub fn fee_and_net(gross: i128) -> Option<(i128, i128)> {
    let fee = fee(gross)?;
    Some((fee, gross.checked_sub(fee)?))
}

/// Tab fee for settling `gross` on top of `paid` already settled for the same
/// `(reader, key_id, writer)`: `fee(paid + gross) - fee(paid)` (I-13, I-31).
pub fn tab_fee(paid: i128, gross: i128) -> Option<i128> {
    if paid < 0 || gross < 0 {
        return None;
    }
    let paid_after = paid.checked_add(gross)?;
    fee(paid_after)?.checked_sub(fee(paid)?)
}

/// Share of `net` for a non-first recipient with `bps` basis points.
///
/// The first recipient's share is `net - Σ other shares`; callers compute it
/// after summing the others, so `fee + Σ shares == gross` always holds (I-2).
pub fn share(net: i128, bps: u32) -> Option<i128> {
    bps_of(net, bps)
}

#[cfg(test)]
mod tests {
    extern crate std;

    use super::*;
    use crate::constants::MIN_FEE_BEARING_AMOUNT;
    use proptest::prelude::*;
    use std::vec::Vec;

    /// Splits `net` across `bps` (first entry receives the remainder).
    fn split(net: i128, bps: &[u32]) -> Option<Vec<i128>> {
        let mut others = Vec::new();
        let mut sum: i128 = 0;
        for b in &bps[1..] {
            let s = share(net, *b)?;
            sum = sum.checked_add(s)?;
            others.push(s);
        }
        let mut shares = Vec::with_capacity(bps.len());
        shares.push(net.checked_sub(sum)?);
        shares.extend(others);
        Some(shares)
    }

    /// Random split vectors: 2 to 5 positive entries summing to 10_000.
    fn bps_vector() -> impl Strategy<Value = Vec<u32>> {
        (2usize..=5).prop_flat_map(|n| {
            proptest::collection::vec(1u32..=9_996, n - 1).prop_map(move |mut cuts| {
                cuts.sort_unstable();
                cuts.dedup();
                let mut out = Vec::new();
                let mut last = 0;
                for c in cuts {
                    out.push(c - last);
                    last = c;
                }
                out.push(BPS_DENOMINATOR - last);
                out
            })
        })
    }

    #[test]
    fn table() {
        // (gross, fee, net)
        let cases: [(i128, i128, i128); 8] = [
            (0, 0, 0),
            (1, 0, 1),
            (39, 0, 39),
            (40, 1, 39),
            (79, 1, 78),
            (80, 2, 78),
            (10_000_000, 250_000, 9_750_000),
            (1_000_000_000_000, 25_000_000_000, 975_000_000_000),
        ];
        for (gross, f, n) in cases {
            assert_eq!(fee_and_net(gross), Some((f, n)), "gross {gross}");
        }
        assert_eq!(fee(MIN_FEE_BEARING_AMOUNT), Some(1));
        assert_eq!(fee(MIN_FEE_BEARING_AMOUNT - 1), Some(0));
    }

    #[test]
    fn invalid_inputs_and_overflow() {
        assert_eq!(fee(-1), None);
        assert_eq!(bps_of(1, BPS_DENOMINATOR + 1), None);
        assert_eq!(fee(i128::MAX), None);
        assert_eq!(tab_fee(i128::MAX, 1), None);
        assert_eq!(tab_fee(-1, 1), None);
        assert_eq!(tab_fee(1, -1), None);
    }

    #[test]
    fn split_table() {
        assert_eq!(split(975, &[10_000]), Some(std::vec![975]));
        assert_eq!(split(975, &[5_000, 5_000]), Some(std::vec![488, 487]));
        assert_eq!(split(3, &[3_334, 3_333, 3_333]), Some(std::vec![3, 0, 0]));
        assert_eq!(
            split(39, &[2_000, 2_000, 2_000, 2_000, 2_000]),
            Some(std::vec![11, 7, 7, 7, 7])
        );
    }

    #[test]
    fn i128_boundaries() {
        // Largest gross whose fee does not overflow: gross * FEE_BPS <= i128::MAX.
        let max_ok = i128::MAX / FEE_BPS as i128;
        let (f, n) = fee_and_net(max_ok).unwrap();
        assert_eq!(f, max_ok * FEE_BPS as i128 / BPS_DENOMINATOR as i128);
        assert_eq!(f + n, max_ok);
        assert_eq!(fee(max_ok + 1), None);
        assert_eq!(fee_and_net(i128::MAX), None);
        assert_eq!(fee(i128::MIN), None);
        // Shares at the limits of `bps`.
        assert_eq!(
            share(i128::MAX / BPS_DENOMINATOR as i128, BPS_DENOMINATOR),
            Some(i128::MAX / BPS_DENOMINATOR as i128)
        );
        assert_eq!(share(1_000, 0), Some(0));
        assert_eq!(share(-1, 1), None);
        // Tab fee next to the overflow edge.
        assert_eq!(
            tab_fee(max_ok - 1, 1),
            Some(fee(max_ok).unwrap() - fee(max_ok - 1).unwrap())
        );
        assert_eq!(tab_fee(max_ok, 1), None);
        assert_eq!(tab_fee(0, 0), Some(0));
    }

    #[test]
    fn one_stroop_increments() {
        // Settling 1 stroop at a time charges 1 stroop of fee on every 40th
        // stroop and nothing otherwise, so the total equals the fee of the sum.
        let mut fees = 0i128;
        for paid in 0..4_000i128 {
            let f = tab_fee(paid, 1).unwrap();
            assert_eq!(
                f,
                if (paid + 1) % MIN_FEE_BEARING_AMOUNT == 0 {
                    1
                } else {
                    0
                }
            );
            fees += f;
        }
        assert_eq!(fees, fee(4_000).unwrap());
        assert_eq!(fees, 100);
        assert_eq!(tab_fee(39, 1), Some(1));
        assert_eq!(tab_fee(40, 39), Some(0));
    }

    proptest! {
        // I-1: fee + net == gross, 0 <= fee <= gross, and the fee is the floor.
        #[test]
        fn fee_plus_net_is_gross(gross in 0i128..=i128::MAX / BPS_DENOMINATOR as i128) {
            let (f, n) = fee_and_net(gross).unwrap();
            prop_assert_eq!(f + n, gross);
            prop_assert!(f >= 0 && f <= gross);
            prop_assert!(f * BPS_DENOMINATOR as i128 <= gross * FEE_BPS as i128);
            prop_assert!((f + 1) * BPS_DENOMINATOR as i128 > gross * FEE_BPS as i128);
            if gross >= MIN_FEE_BEARING_AMOUNT {
                prop_assert!(f >= 1);
            }
        }

        // I-2: fee + Σ shares == gross for 1 to 5 recipients; no share is negative.
        #[test]
        fn split_conserves_gross(gross in 40i128..=1_000_000_000_000, bps in bps_vector()) {
            prop_assert_eq!(bps.iter().sum::<u32>(), BPS_DENOMINATOR);
            let (f, n) = fee_and_net(gross).unwrap();
            let shares = split(n, &bps).unwrap();
            prop_assert_eq!(shares.len(), bps.len());
            prop_assert!(shares.iter().all(|s| *s >= 0));
            prop_assert_eq!(f + shares.iter().sum::<i128>(), gross);
        }

        // I-31: incremental tab fees sum to the fee of the cumulative total.
        #[test]
        fn tab_fees_sum_to_cumulative_fee(
            increments in proptest::collection::vec(1i128..=10_000_000_000, 1..64)
        ) {
            let mut paid = 0i128;
            let mut fees = 0i128;
            for gross in increments {
                let f = tab_fee(paid, gross).unwrap();
                prop_assert!(f >= 0 && f <= gross);
                fees += f;
                paid += gross;
            }
            prop_assert_eq!(fees, fee(paid).unwrap());
        }

        // I-31 with dust increments from any starting point: each increment's
        // fee is within [0, gross], and the sum equals fee(end) - fee(start).
        #[test]
        fn tab_fees_with_dust_increments(
            start in 0i128..=1_000_000_000_000_000,
            increments in proptest::collection::vec(1i128..=100, 1..256)
        ) {
            let mut paid = start;
            let mut fees = 0i128;
            for gross in increments {
                let f = tab_fee(paid, gross).unwrap();
                prop_assert!(f >= 0 && f <= gross);
                fees += f;
                paid += gross;
            }
            prop_assert_eq!(fees, fee(paid).unwrap() - fee(start).unwrap());
        }

        // The cumulative rule is path independent: two partitions of the same
        // total charge the same total fee.
        #[test]
        fn tab_fee_is_path_independent(total in 1i128..=10_000_000_000, cut in 0i128..=10_000_000_000) {
            let cut = cut % (total + 1);
            let one = tab_fee(0, total).unwrap();
            let two = tab_fee(0, cut).unwrap() + tab_fee(cut, total - cut).unwrap();
            prop_assert_eq!(one, two);
            prop_assert_eq!(one, fee(total).unwrap());
        }
    }
}
