//! Decoding arbitrary XDR as a `Voucher` never panics, and a decoded voucher
//! round-trips to the same `ScVal`.
#![no_main]

use libfuzzer_sys::fuzz_target;
use quilltip_tab::Voucher;
use soroban_sdk::xdr::{Limits, ReadXdr, ScVal};
use soroban_sdk::{Env, TryFromVal};

fuzz_target!(|data: &[u8]| {
    let Ok(val) = ScVal::from_xdr(data, Limits::len(data.len())) else {
        return;
    };
    let e = Env::default();
    if let Ok(v) = Voucher::try_from_val(&e, &val) {
        let back = ScVal::try_from(&v).expect("a decoded voucher encodes");
        let again = Voucher::try_from_val(&e, &back).expect("round trip");
        assert_eq!(v, again);
    }
});
