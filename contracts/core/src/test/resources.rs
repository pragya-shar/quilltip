//! Resource tests under the SDK's default mainnet limits (section 8.1
//! "Resource"; caps in section 2.2). `Env::default()` enforces
//! `InvocationResourceLimits::mainnet()`, so an invocation above any limit
//! fails the test.
//!
//! The native tests run with `cargo test`. The `wasm_` tests run the
//! CLI-built Wasm and are ignored unless `QUILLTIP_WASM_DIR` is set; CI runs
//! them after the reproducible build. Native instruction counts are lower
//! than Wasm counts.

use soroban_sdk::testutils::Address as _;
use soroban_sdk::Address;

use super::batch::{item, items};
use super::*;

/// Mainnet per-transaction limits checked explicitly in addition to the
/// SDK's enforcement.
const MAX_EVENT_BYTES: u32 = 16_384;
const MAX_WRITE_ENTRIES: u32 = 200;

/// The test Env's CPU and memory budget accumulates across every call in the
/// test, including setup. Reset it before the measured call; the per-call
/// mainnet limits stay enforced.
fn fresh_budget(f: &Fixture) {
    f.e.cost_estimate().budget().reset_unlimited();
}

fn report(label: &str, f: &Fixture) -> soroban_sdk::testutils::cost_estimate::CostEstimate {
    let estimate = f.e.cost_estimate();
    let r = estimate.resources();
    std::println!(
        "{label}: instructions={} mem_bytes={} disk_read_entries={} memory_read_entries={} \
         write_entries={} write_bytes={} event_bytes={} fee_estimate_stroops={}",
        r.instructions,
        r.mem_bytes,
        r.disk_read_entries,
        r.memory_read_entries,
        r.write_entries,
        r.write_bytes,
        r.contract_events_size_bytes,
        estimate.fee().total
    );
    assert!(r.contract_events_size_bytes <= MAX_EVENT_BYTES);
    assert!(r.write_entries <= MAX_WRITE_ENTRIES);
    estimate
}

/// `tip` with five recipients and a highlight: at most 6 token transfers.
fn five_recipient_tip(f: &Fixture) {
    let (id, _) = f.article_with_splits(&[2_000; 5]);
    let tipper = f.funded();
    fresh_budget(f);
    f.core.tip(
        &tipper,
        &id,
        &f.token,
        &123_456_789,
        &Some(hash(&f.e, 9)),
        &client_ref(&f.e, 1),
    );
    let estimate = report("tip, 5 recipients, highlight", f);
    // Spec estimate: Tipped event bytes "at most about 2.2 KB".
    assert!(estimate.resources().contract_events_size_bytes <= 2_400);
}

/// `tip_batch` at both caps: 10 items, 24 transfers, every item with a
/// highlight, distinct articles and fresh recipients (the worst case for
/// writes).
fn full_batch(f: &Fixture) {
    let mut list = std::vec::Vec::new();
    // Σ recipients = 14 over 10 items: eight plain, one with 2, one with 4.
    for n in 0..8 {
        let (id, _) = f.article();
        list.push(item(f, &id, MIN_TIP, n));
    }
    let (two, _) = f.article_with_splits(&[5_000, 5_000]);
    list.push(item(f, &two, MIN_TIP, 8));
    let (four, _) = f.article_with_splits(&[2_500; 4]);
    list.push(item(f, &four, MIN_TIP, 9));
    let tipper = f.funded();
    let list = items(f, &list);
    fresh_budget(f);
    f.core.tip_batch(&tipper, &f.token, &list);
    report("tip_batch, 10 items, 24 transfers, highlights", f);
}

#[test]
fn native_five_recipient_tip_fits_mainnet_limits() {
    five_recipient_tip(&Fixture::new());
}

#[test]
fn native_full_batch_fits_mainnet_limits() {
    full_batch(&Fixture::new());
}

#[test]
#[ignore = "needs QUILLTIP_WASM_DIR with the CLI-built quilltip_core.wasm"]
fn wasm_five_recipient_tip_fits_mainnet_limits() {
    let code = wasm_file("quilltip_core.wasm");
    five_recipient_tip(&Fixture::deploy(Some(&code)));
}

#[test]
#[ignore = "needs QUILLTIP_WASM_DIR with the CLI-built quilltip_core.wasm"]
fn wasm_full_batch_fits_mainnet_limits() {
    let code = wasm_file("quilltip_core.wasm");
    full_batch(&Fixture::deploy(Some(&code)));
}

/// Registration of an article with five recipients (the largest record).
#[test]
#[ignore = "needs QUILLTIP_WASM_DIR with the CLI-built quilltip_core.wasm"]
fn wasm_register_five_recipients() {
    let code = wasm_file("quilltip_core.wasm");
    let f = Fixture::deploy(Some(&code));
    let r: std::vec::Vec<Address> = (0..5).map(|_| Address::generate(&f.e)).collect();
    let s = splits(&f.e, &r, &[2_000; 5]);
    fresh_budget(&f);
    f.core.register_article(
        &r[0],
        &random_id(&f.e),
        &hash(&f.e, 1),
        &Some(hash(&f.e, 2)),
        &s,
    );
    report("register_article, 5 recipients", &f);
}
