//! Resource bounds at the maximum batch (`03-tab-contract.md`, section 3.11).
//!
//! The SDK enforces mainnet per-transaction limits on every invocation in tests,
//! so a batch that exceeds any limit fails. The figures are printed with
//! `cargo test -p quilltip-tab resource -- --nocapture`.
//!
//! `settle_max_batch_wasm` repeats the measurement on a built Wasm:
//! `QUILLTIP_TAB_WASM=<path to quilltip_tab.wasm> cargo test -p quilltip-tab resource -- --ignored --nocapture`.
use super::*;
use crate::MAX_SETTLE_BATCH;

const MAX_EVENT_BYTES: u32 = 14_000;
const MAX_WRITE_ENTRIES: u32 = 200;

/// `MAX_SETTLE_BATCH` vouchers, every reader and writer distinct (the worst case).
fn max_batch(f: &Fixture, accepted: bool, writer: Option<&Address>) -> Vec<Voucher> {
    let mut out = Vec::new(&f.e);
    for i in 0..MAX_SETTLE_BATCH {
        let (reader, key, key_id) = f.reader(10 * XLM, 10 * XLM);
        let w = writer.cloned().unwrap_or_else(|| Address::generate(&f.e));
        let v = f.voucher(&reader, &w, key_id, &key, XLM + i as i128);
        out.push_back(if accepted {
            f.accept(&v, &key, &f.acceptor)
        } else {
            v
        });
    }
    out
}

fn report(f: &Fixture, label: &str) -> (i64, u32, u32, u32) {
    let r = f.e.cost_estimate().resources();
    std::println!(
        "{label}: vouchers={MAX_SETTLE_BATCH} instructions={} write_entries={} write_bytes={} disk_read_entries={} memory_read_entries={} event_bytes={}",
        r.instructions, r.write_entries, r.write_bytes, r.disk_read_entries, r.memory_read_entries, r.contract_events_size_bytes
    );
    assert!(
        r.contract_events_size_bytes <= MAX_EVENT_BYTES,
        "{label}: events {}",
        r.contract_events_size_bytes
    );
    assert!(
        r.write_entries <= MAX_WRITE_ENTRIES,
        "{label}: write entries {}",
        r.write_entries
    );
    (
        r.instructions,
        r.write_entries,
        r.write_bytes,
        r.contract_events_size_bytes,
    )
}

#[test]
fn settle_max_batch_within_limits() {
    let f = Fixture::quiet();
    let vs = max_batch(&f, false, None);
    // First settlement creates every Paid and Claimable entry.
    assert_eq!(f.settle(&vs).settled, MAX_SETTLE_BATCH);
    report(&f, "settle (new entries)");
    // Steady state: same pairs, higher cumulative.
    let mut next = Vec::new(&f.e);
    for v in vs.iter() {
        let key = key_for(&v.reader);
        next.push_back(f.voucher(&v.reader, &v.writer, v.key_id, &key, v.cumulative + XLM));
    }
    assert_eq!(f.settle(&next).settled, MAX_SETTLE_BATCH);
    report(&f, "settle (steady)");
}

#[test]
fn settle_own_max_batch_within_limits() {
    let f = Fixture::quiet();
    let w = Address::generate(&f.e);
    let vs = max_batch(&f, true, Some(&w));
    assert_eq!(f.settle_own(&w, &vs).settled, MAX_SETTLE_BATCH);
    report(&f, "settle_own (new entries)");
}

#[test]
#[ignore = "needs QUILLTIP_TAB_WASM pointing at a built quilltip_tab.wasm"]
fn settle_max_batch_wasm() {
    let path = std::env::var("QUILLTIP_TAB_WASM").expect("QUILLTIP_TAB_WASM");
    let wasm = std::fs::read(path).expect("read wasm");
    let base = Fixture::quiet();
    let e = base.e.clone();
    let tab = e.register(
        wasm.as_slice(),
        (
            &base.admin,
            &base.pauser,
            &base.upgrader,
            &base.settler,
            &base.token,
            &base.treasury,
            MAX_BALANCE,
            MIN_DEPOSIT,
            public_key(&e, &base.acceptor),
        ),
    );
    let f = Fixture { tab, ..base };
    let vs = max_batch(&f, false, None);
    assert_eq!(f.settle(&vs).settled, MAX_SETTLE_BATCH);
    report(&f, "wasm settle (new entries)");
    let w = Address::generate(&f.e);
    let own = max_batch(&f, true, Some(&w));
    assert_eq!(f.settle_own(&w, &own).settled, MAX_SETTLE_BATCH);
    report(&f, "wasm settle_own (new entries)");
}
