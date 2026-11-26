//! Property tests (I-1, I-2, I-3, I-6). Each case deploys Core and a SAC and
//! checks real token balances, not only the arithmetic.

use proptest::prelude::*;

use super::*;

/// Random split vectors: empty, or 2 to 5 positive entries summing to 10,000.
fn bps_vector() -> impl Strategy<Value = std::vec::Vec<u32>> {
    prop_oneof![
        Just(std::vec::Vec::new()),
        (2usize..=5).prop_flat_map(|n| {
            proptest::collection::vec(1u32..=9_999, n - 1).prop_map(|mut cuts| {
                cuts.sort_unstable();
                cuts.dedup();
                let mut out = std::vec::Vec::new();
                let mut last = 0;
                for c in cuts {
                    out.push(c - last);
                    last = c;
                }
                out.push(10_000 - last);
                if out.len() < 2 {
                    out = std::vec![5_000, 5_000];
                }
                out
            })
        }),
    ]
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 48, ..ProptestConfig::default() })]

    /// I-1, I-2, I-6: for every tip, the treasury gets exactly
    /// `floor(gross × 250 / 10,000)`, each non-primary recipient gets
    /// `floor(net × bps / 10,000)`, the primary author the remainder,
    /// everything sums to `gross`, and Core holds nothing.
    #[test]
    fn split_conserves_gross(gross in 40i128..=1_000_000_000_000, bps in bps_vector()) {
        let f = Fixture::without_snapshot();
        f.core.set_token(&f.token, &40, &true);
        let (id, recipients) = if bps.is_empty() {
            let (id, author) = f.article();
            (id, std::vec![author])
        } else {
            f.article_with_splits(&bps)
        };
        let tipper = f.funded();
        f.core.tip(&tipper, &id, &f.token, &gross, &None, &client_ref(&f.e, 1));

        let fee = gross * 250 / 10_000;
        let net = gross - fee;
        prop_assert_eq!(f.balance(&f.treasury), fee);
        let mut others = 0i128;
        for (i, r) in recipients.iter().enumerate().skip(1) {
            let expected = net * i128::from(bps[i]) / 10_000;
            prop_assert_eq!(f.balance(r), expected);
            others += expected;
        }
        prop_assert_eq!(f.balance(&recipients[0]), net - others);
        let paid: i128 = recipients.iter().map(|r| f.balance(r)).sum::<i128>() + fee;
        prop_assert_eq!(paid, gross);
        prop_assert_eq!(f.balance(&f.id()), 0);
        prop_assert_eq!(f.balance(&tipper), FUNDS - gross);
    }

    /// I-3: across a random sequence of tips, the total grows by exactly
    /// `gross` per successful tip and never decreases; failed tips leave it
    /// unchanged.
    #[test]
    fn totals_are_monotonic(amounts in proptest::collection::vec(-5i128..=50_000_000, 1..12)) {
        let f = Fixture::without_snapshot();
        let (id, _) = f.article();
        let tipper = f.funded();
        let mut expected = 0i128;
        for (n, amount) in amounts.iter().enumerate() {
            let before = f.core.article_total(&id, &f.token);
            let ok = f
                .core
                .try_tip(&tipper, &id, &f.token, amount, &None, &client_ref(&f.e, n as u32))
                .is_ok();
            let after = f.core.article_total(&id, &f.token);
            prop_assert!(after >= before);
            prop_assert_eq!(ok, *amount >= MIN_TIP);
            if ok {
                expected += amount;
                prop_assert_eq!(after - before, *amount);
            } else {
                prop_assert_eq!(after, before);
            }
        }
        prop_assert_eq!(f.core.article_total(&id, &f.token), expected);
    }
}
