extern crate std;

use soroban_sdk::Env;

use crate::QuillTipCore;

#[test]
fn registers() {
    let e = Env::default();
    let _id = e.register(QuillTipCore, ());
}
