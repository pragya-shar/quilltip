#![no_std]
use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype, token, vec, Address, Env, String, Symbol,
    Vec,
};
use stellar_contract_utils::pausable;

#[derive(Clone)]
#[contracttype]
pub struct SimpleTip {
    pub tipper: Address,
    pub amount: i128,
    pub timestamp: u64,
}

#[derive(Clone)]
#[contracttype]
pub struct TipReceipt {
    pub tip_id: u64,
    pub amount_sent: i128,
    pub author_received: i128,
    pub platform_fee: i128,
    pub timestamp: u64,
}

#[derive(Clone)]
#[contracttype]
pub struct ArticleTipInput {
    pub article_id: Symbol,
    pub author: Address,
    pub amount: i128,
}

#[derive(Clone)]
#[contracttype]
pub struct HighlightTipInput {
    pub highlight_id: String,
    pub article_id: Symbol,
    pub author: Address,
    pub amount: i128,
}

#[derive(Clone)]
#[contracttype]
pub struct BatchTipReceipt {
    pub receipts: Vec<TipReceipt>,
    pub total_amount: i128,
    pub total_author_received: i128,
    pub total_platform_fee: i128,
}

#[contractevent(topics = ["tip_with_arweave"], data_format = "single-value")]
pub struct TipWithArweave {
    #[topic]
    pub article_id: Symbol,
    pub data: (Address, Address, i128, String),
}

#[contractevent(topics = ["highlight_tip_arweave"], data_format = "single-value")]
pub struct HighlightTipArweave {
    #[topic]
    pub highlight_id: String,
    pub data: (Address, Address, i128, String),
}

#[contractevent(topics = ["batch_tip"], data_format = "single-value")]
pub struct BatchTipEvent {
    pub data: (Address, Symbol, Address, i128, i128, i128, u64),
}

#[contractevent(topics = ["batch_tip_highlights"], data_format = "single-value")]
pub struct BatchHighlightTipEvent {
    pub data: (Address, String, Symbol, Address, i128, i128, i128, u64),
}

#[derive(Clone)]
#[contracttype]
pub struct HighlightTip {
    pub highlight_id: String, // Unique highlight identifier (SHA256)
    pub article_id: Symbol,   // Parent article (Convex ID - alphanumeric, Symbol-safe)
    pub tipper: Address,
    pub amount: i128,
    pub timestamp: u64,
}

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    PlatformAddress,
    TokenAddress,
    PlatformFeeBps,
    ArticleTips(Symbol),
    ArticleTotalTips(Symbol), // Track total tips per article for NFT threshold
    TipCounter,
    TotalVolume,
    HighlightTips(String), // Highlight ID → Tips
    Paused,                // Emergency pause state (OZ Pausable)
}

const MINIMUM_TIP_STROOPS: i128 = 100_000; // 0.01 XLM (approximately 1 cent)
const DEFAULT_PLATFORM_FEE_BPS: u32 = 250; // 2.5%

fn validate_minimum_tip(amount: i128) {
    if amount < MINIMUM_TIP_STROOPS {
        panic!("Amount below minimum tip");
    }
}

fn calculate_tip_split(amount: i128, platform_fee_bps: u32) -> (i128, i128) {
    let platform_fee = (amount * platform_fee_bps as i128) / 10_000;
    let author_share = amount - platform_fee;
    (author_share, platform_fee)
}

fn get_token_address(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::TokenAddress)
        .expect("Token address not set")
}

#[contract]
pub struct TippingContract;

#[contractimpl]
impl TippingContract {
    /// Initialize the contract with platform settings
    pub fn initialize(
        env: Env,
        admin: Address,
        platform_address: Address,
        token_address: Address,
        fee_bps: Option<u32>,
    ) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("Contract already initialized");
        }

        admin.require_auth();

        let platform_fee = fee_bps.unwrap_or(DEFAULT_PLATFORM_FEE_BPS);

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::PlatformAddress, &platform_address);
        env.storage()
            .instance()
            .set(&DataKey::TokenAddress, &token_address);
        env.storage()
            .instance()
            .set(&DataKey::PlatformFeeBps, &platform_fee);
        env.storage().persistent().set(&DataKey::TipCounter, &0u64);
        env.storage()
            .persistent()
            .set(&DataKey::TotalVolume, &0i128);
    }

    /// Send a tip for an article
    pub fn tip_article(
        env: Env,
        tipper: Address,
        article_id: Symbol,
        author: Address,
        amount: i128,
    ) -> TipReceipt {
        pausable::when_not_paused(&env);
        tipper.require_auth();

        // Validate minimum amount
        if amount < MINIMUM_TIP_STROOPS {
            panic!("Amount below minimum tip");
        }

        // Get platform settings
        let platform_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::PlatformAddress)
            .expect("Platform address not set");

        let platform_fee_bps: u32 = env
            .storage()
            .instance()
            .get(&DataKey::PlatformFeeBps)
            .unwrap_or(DEFAULT_PLATFORM_FEE_BPS);

        // Calculate fees
        let platform_fee = (amount * platform_fee_bps as i128) / 10_000;
        let author_share = amount - platform_fee;

        // Get configured token client
        let token_address = get_token_address(&env);
        let token_client = token::TokenClient::new(&env, &token_address);

        // Transfer author's share
        token_client.transfer(&tipper, &author, &author_share);

        // Transfer platform fee
        if platform_fee > 0 {
            token_client.transfer(&tipper, &platform_address, &platform_fee);
        }

        // Track cumulative tips for statistics (not balances)
        let current_total: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::ArticleTotalTips(article_id.clone()))
            .unwrap_or(0);

        env.storage().persistent().set(
            &DataKey::ArticleTotalTips(article_id.clone()),
            &(current_total + amount),
        );

        // Get and increment tip counter
        let tip_counter: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::TipCounter)
            .unwrap_or(0);

        let new_tip_id = tip_counter + 1;
        env.storage()
            .persistent()
            .set(&DataKey::TipCounter, &new_tip_id);

        // Store tip data
        let tip = SimpleTip {
            tipper: tipper.clone(),
            amount,
            timestamp: env.ledger().timestamp(),
        };

        // Get existing tips for article
        let mut article_tips: Vec<SimpleTip> = env
            .storage()
            .persistent()
            .get(&DataKey::ArticleTips(article_id.clone()))
            .unwrap_or(vec![&env]);

        article_tips.push_back(tip);

        env.storage()
            .persistent()
            .set(&DataKey::ArticleTips(article_id.clone()), &article_tips);

        // Update total volume
        let total_volume: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::TotalVolume)
            .unwrap_or(0);

        env.storage()
            .persistent()
            .set(&DataKey::TotalVolume, &(total_volume + amount));

        // Create receipt
        TipReceipt {
            tip_id: new_tip_id,
            amount_sent: amount,
            author_received: author_share,
            platform_fee,
            timestamp: env.ledger().timestamp(),
        }
    }

    /// Send multiple article tips in one contract call.
    pub fn batch_tip(env: Env, tipper: Address, tips: Vec<ArticleTipInput>) -> BatchTipReceipt {
        pausable::when_not_paused(&env);
        tipper.require_auth();

        if tips.len() == 0 {
            panic!("Batch tip input cannot be empty");
        }

        let mut index = 0;
        while index < tips.len() {
            let tip = tips.get(index).unwrap();
            validate_minimum_tip(tip.amount);
            index += 1;
        }

        let platform_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::PlatformAddress)
            .expect("Platform address not set");

        let platform_fee_bps: u32 = env
            .storage()
            .instance()
            .get(&DataKey::PlatformFeeBps)
            .unwrap_or(DEFAULT_PLATFORM_FEE_BPS);

        let token_address = get_token_address(&env);
        let token_client = token::TokenClient::new(&env, &token_address);

        let mut receipts: Vec<TipReceipt> = vec![&env];
        let mut total_amount = 0i128;
        let mut total_author_received = 0i128;
        let mut total_platform_fee = 0i128;

        index = 0;
        while index < tips.len() {
            let tip = tips.get(index).unwrap();
            let (author_share, platform_fee) = calculate_tip_split(tip.amount, platform_fee_bps);

            token_client.transfer(&tipper, &tip.author, &author_share);

            if platform_fee > 0 {
                token_client.transfer(&tipper, &platform_address, &platform_fee);
            }

            let current_total: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::ArticleTotalTips(tip.article_id.clone()))
                .unwrap_or(0);

            env.storage().persistent().set(
                &DataKey::ArticleTotalTips(tip.article_id.clone()),
                &(current_total + tip.amount),
            );

            let tip_counter: u64 = env
                .storage()
                .persistent()
                .get(&DataKey::TipCounter)
                .unwrap_or(0);

            let new_tip_id = tip_counter + 1;
            env.storage()
                .persistent()
                .set(&DataKey::TipCounter, &new_tip_id);

            let timestamp = env.ledger().timestamp();
            let stored_tip = SimpleTip {
                tipper: tipper.clone(),
                amount: tip.amount,
                timestamp,
            };

            let mut article_tips: Vec<SimpleTip> = env
                .storage()
                .persistent()
                .get(&DataKey::ArticleTips(tip.article_id.clone()))
                .unwrap_or(vec![&env]);

            article_tips.push_back(stored_tip);

            env.storage()
                .persistent()
                .set(&DataKey::ArticleTips(tip.article_id.clone()), &article_tips);

            let total_volume: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::TotalVolume)
                .unwrap_or(0);

            env.storage()
                .persistent()
                .set(&DataKey::TotalVolume, &(total_volume + tip.amount));

            let receipt = TipReceipt {
                tip_id: new_tip_id,
                amount_sent: tip.amount,
                author_received: author_share,
                platform_fee,
                timestamp,
            };

            receipts.push_back(receipt);

            BatchTipEvent {
                data: (
                    tipper.clone(),
                    tip.article_id,
                    tip.author,
                    tip.amount,
                    author_share,
                    platform_fee,
                    new_tip_id,
                ),
            }
            .publish(&env);

            total_amount += tip.amount;
            total_author_received += author_share;
            total_platform_fee += platform_fee;
            index += 1;
        }

        BatchTipReceipt {
            receipts,
            total_amount,
            total_author_received,
            total_platform_fee,
        }
    }

    /// Get all tips for an article
    pub fn get_article_tips(env: Env, article_id: Symbol) -> Vec<SimpleTip> {
        env.storage()
            .persistent()
            .get(&DataKey::ArticleTips(article_id))
            .unwrap_or(vec![&env])
    }

    /// Get author's balance from the configured token
    pub fn get_balance(env: Env, author: Address) -> i128 {
        let token_address = get_token_address(&env);
        let token_client = token::TokenClient::new(&env, &token_address);
        token_client.balance(&author)
    }

    /// Get total tips for an article (for NFT threshold checking)
    pub fn get_article_total_tips(env: Env, article_id: Symbol) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::ArticleTotalTips(article_id))
            .unwrap_or(0)
    }

    /// Check if article has reached NFT minting threshold
    pub fn is_nft_eligible(env: Env, article_id: Symbol, threshold: i128) -> bool {
        let total_tips = Self::get_article_total_tips(env, article_id);
        total_tips >= threshold
    }

    /// Withdraw is no longer needed - transfers happen immediately
    /// Keeping for backwards compatibility, returns 0
    pub fn withdraw_earnings(_env: Env, author: Address) -> i128 {
        author.require_auth();
        // Transfers happen immediately in tip_article
        // This function is deprecated but kept for backwards compatibility
        0
    }

    /// Get total tips volume
    pub fn get_total_volume(env: Env) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::TotalVolume)
            .unwrap_or(0)
    }

    /// Update platform fee (admin only)
    pub fn update_fee(env: Env, admin: Address, new_fee_bps: u32) {
        admin.require_auth();

        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");

        if admin != stored_admin {
            panic!("Unauthorized");
        }

        if new_fee_bps > 1000 {
            // Max 10%
            panic!("Fee too high");
        }

        env.storage()
            .instance()
            .set(&DataKey::PlatformFeeBps, &new_fee_bps);
    }

    /// Tip a highlight directly (same flow as tip_article)
    pub fn tip_highlight_direct(
        env: Env,
        tipper: Address,
        highlight_id: String,
        article_id: Symbol,
        author: Address,
        amount: i128,
    ) -> TipReceipt {
        pausable::when_not_paused(&env);
        tipper.require_auth();

        // Validate minimum amount
        if amount < MINIMUM_TIP_STROOPS {
            panic!("Amount below minimum tip");
        }

        // Get platform settings (reuse existing code)
        let platform_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::PlatformAddress)
            .expect("Platform address not set");

        let platform_fee_bps: u32 = env
            .storage()
            .instance()
            .get(&DataKey::PlatformFeeBps)
            .unwrap_or(DEFAULT_PLATFORM_FEE_BPS);

        // Calculate fees (same as tip_article)
        let platform_fee = (amount * platform_fee_bps as i128) / 10_000;
        let author_share = amount - platform_fee;

        // Get configured token client (same as tip_article)
        let token_address = get_token_address(&env);
        let token_client = token::TokenClient::new(&env, &token_address);

        // Transfer author's share
        token_client.transfer(&tipper, &author, &author_share);

        // Transfer platform fee
        if platform_fee > 0 {
            token_client.transfer(&tipper, &platform_address, &platform_fee);
        }

        // Get and increment tip counter (same as tip_article)
        let tip_counter: u64 = env
            .storage()
            .persistent()
            .get(&DataKey::TipCounter)
            .unwrap_or(0);

        let new_tip_id = tip_counter + 1;
        env.storage()
            .persistent()
            .set(&DataKey::TipCounter, &new_tip_id);

        // Store highlight tip
        let tip = HighlightTip {
            highlight_id: highlight_id.clone(),
            article_id,
            tipper: tipper.clone(),
            amount,
            timestamp: env.ledger().timestamp(),
        };

        // Get existing tips for highlight
        let mut highlight_tips: Vec<HighlightTip> = env
            .storage()
            .persistent()
            .get(&DataKey::HighlightTips(highlight_id.clone()))
            .unwrap_or(vec![&env]);

        highlight_tips.push_back(tip);

        env.storage()
            .persistent()
            .set(&DataKey::HighlightTips(highlight_id), &highlight_tips);

        // Create receipt (same format as tip_article)
        TipReceipt {
            tip_id: new_tip_id,
            amount_sent: amount,
            author_received: author_share,
            platform_fee,
            timestamp: env.ledger().timestamp(),
        }
    }

    /// Send multiple highlight tips in one contract call.
    pub fn batch_tip_highlights(
        env: Env,
        tipper: Address,
        tips: Vec<HighlightTipInput>,
    ) -> BatchTipReceipt {
        pausable::when_not_paused(&env);
        tipper.require_auth();

        if tips.len() == 0 {
            panic!("Batch tip input cannot be empty");
        }

        let mut index = 0;
        while index < tips.len() {
            let tip = tips.get(index).unwrap();
            validate_minimum_tip(tip.amount);
            index += 1;
        }

        let platform_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::PlatformAddress)
            .expect("Platform address not set");

        let platform_fee_bps: u32 = env
            .storage()
            .instance()
            .get(&DataKey::PlatformFeeBps)
            .unwrap_or(DEFAULT_PLATFORM_FEE_BPS);

        let token_address = get_token_address(&env);
        let token_client = token::TokenClient::new(&env, &token_address);

        let mut receipts: Vec<TipReceipt> = vec![&env];
        let mut total_amount = 0i128;
        let mut total_author_received = 0i128;
        let mut total_platform_fee = 0i128;

        index = 0;
        while index < tips.len() {
            let tip = tips.get(index).unwrap();
            let (author_share, platform_fee) = calculate_tip_split(tip.amount, platform_fee_bps);

            token_client.transfer(&tipper, &tip.author, &author_share);

            if platform_fee > 0 {
                token_client.transfer(&tipper, &platform_address, &platform_fee);
            }

            let tip_counter: u64 = env
                .storage()
                .persistent()
                .get(&DataKey::TipCounter)
                .unwrap_or(0);

            let new_tip_id = tip_counter + 1;
            env.storage()
                .persistent()
                .set(&DataKey::TipCounter, &new_tip_id);

            let timestamp = env.ledger().timestamp();
            let stored_tip = HighlightTip {
                highlight_id: tip.highlight_id.clone(),
                article_id: tip.article_id.clone(),
                tipper: tipper.clone(),
                amount: tip.amount,
                timestamp,
            };

            let mut highlight_tips: Vec<HighlightTip> = env
                .storage()
                .persistent()
                .get(&DataKey::HighlightTips(tip.highlight_id.clone()))
                .unwrap_or(vec![&env]);

            highlight_tips.push_back(stored_tip);

            env.storage().persistent().set(
                &DataKey::HighlightTips(tip.highlight_id.clone()),
                &highlight_tips,
            );

            let total_volume: i128 = env
                .storage()
                .persistent()
                .get(&DataKey::TotalVolume)
                .unwrap_or(0);

            env.storage()
                .persistent()
                .set(&DataKey::TotalVolume, &(total_volume + tip.amount));

            let receipt = TipReceipt {
                tip_id: new_tip_id,
                amount_sent: tip.amount,
                author_received: author_share,
                platform_fee,
                timestamp,
            };

            receipts.push_back(receipt);

            BatchHighlightTipEvent {
                data: (
                    tipper.clone(),
                    tip.highlight_id,
                    tip.article_id,
                    tip.author,
                    tip.amount,
                    author_share,
                    platform_fee,
                    new_tip_id,
                ),
            }
            .publish(&env);

            total_amount += tip.amount;
            total_author_received += author_share;
            total_platform_fee += platform_fee;
            index += 1;
        }

        BatchTipReceipt {
            receipts,
            total_amount,
            total_author_received,
            total_platform_fee,
        }
    }

    /// Get all tips for a highlight
    pub fn get_highlight_tips(env: Env, highlight_id: String) -> Vec<HighlightTip> {
        env.storage()
            .persistent()
            .get(&DataKey::HighlightTips(highlight_id))
            .unwrap_or(vec![&env])
    }

    // ========== PAUSABLE PATTERN (OZ) ==========

    /// Check if contract is paused
    pub fn is_paused(env: Env) -> bool {
        pausable::paused(&env)
    }

    /// Pause the contract (admin only)
    pub fn pause(env: Env, admin: Address) {
        admin.require_auth();

        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");

        if admin != stored_admin {
            panic!("Unauthorized");
        }

        pausable::pause(&env);
    }

    /// Unpause the contract (admin only)
    pub fn unpause(env: Env, admin: Address) {
        admin.require_auth();

        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("Admin not set");

        if admin != stored_admin {
            panic!("Unauthorized");
        }

        pausable::unpause(&env);
    }

    // ========== ARWEAVE-ENABLED TIPPING ==========

    /// Tip an article with Arweave reference
    pub fn tip_article_with_arweave(
        env: Env,
        tipper: Address,
        article_id: Symbol,
        author: Address,
        amount: i128,
        arweave_tx_id: String,
    ) -> TipReceipt {
        // Check not paused
        pausable::when_not_paused(&env);

        // Execute normal tip
        let receipt = Self::tip_article(
            env.clone(),
            tipper.clone(),
            article_id.clone(),
            author.clone(),
            amount,
        );

        // Emit event with Arweave TX ID
        TipWithArweave {
            article_id,
            data: (tipper, author, amount, arweave_tx_id),
        }
        .publish(&env);

        receipt
    }

    /// Tip a highlight with Arweave reference
    pub fn tip_highlight_with_arweave(
        env: Env,
        tipper: Address,
        highlight_id: String,
        article_id: Symbol,
        author: Address,
        amount: i128,
        arweave_tx_id: String,
    ) -> TipReceipt {
        // Check not paused
        pausable::when_not_paused(&env);

        // Execute normal highlight tip
        let receipt = Self::tip_highlight_direct(
            env.clone(),
            tipper.clone(),
            highlight_id.clone(),
            article_id.clone(),
            author.clone(),
            amount,
        );

        // Emit event with Arweave TX ID
        HighlightTipArweave {
            highlight_id,
            data: (tipper, author, amount, arweave_tx_id),
        }
        .publish(&env);

        receipt
    }
}
