use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, BytesN, Env,
};
use stellarcade_random_generator::{RandomGenerator, RandomGeneratorClient as RngTestClient};

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

fn create_token<'a>(env: &'a Env, admin: &Address) -> (Address, StellarAssetClient<'a>) {
    let contract = env.register_stellar_asset_contract_v2(admin.clone());
    let client = StellarAssetClient::new(env, &contract.address());
    (contract.address(), client)
}

fn seed(env: &Env, byte: u8) -> BytesN<32> {
    let mut arr = [0u8; 32];
    arr[31] = byte;
    BytesN::from_array(env, &arr)
}

struct Setup<'a> {
    flip_client: CoinFlipClient<'a>,
    rng_client: RngTestClient<'a>,
    /// Address of the coin-flip contract; it is the RNG "caller" its requests
    /// are namespaced under.
    flip_id: Address,
    admin: Address,
    oracle: Address,
    token_addr: Address,
    token_sac: StellarAssetClient<'a>,
}

fn setup(env: &Env) -> Setup<'_> {
    let admin = Address::generate(env);
    let oracle = Address::generate(env);
    let token_admin = Address::generate(env);

    let (token_addr, token_sac) = create_token(env, &token_admin);

    // Deploy RNG
    let rng_id = env.register(RandomGenerator, ());
    let rng_client = RngTestClient::new(env, &rng_id);

    // Deploy CoinFlip
    let flip_id = env.register(CoinFlip, ());
    let flip_client = CoinFlipClient::new(env, &flip_id);

    env.mock_all_auths();

    // Init RNG and authorize coin flip as a caller
    rng_client.init(&admin, &oracle);
    rng_client.authorize(&admin, &flip_id);

    // Pre-commit a batch of seed commitments so requests can pop them in FIFO order
    let mut commitments = soroban_sdk::Vec::new(env);
    for i in 0..100u8 {
        let s = seed(env, i);
        let h: BytesN<32> = env
            .crypto()
            .sha256(&soroban_sdk::Bytes::from_slice(env, &s.to_array()))
            .into();
        commitments.push_back(h);
    }
    rng_client.commit_seeds(&oracle, &commitments);

    // Init CoinFlip: min=10, max=1000, house edge 250 bps (2.5%)
    flip_client.init(&admin, &rng_id, &token_addr, &10i128, &1000i128, &250i128);

    // Fund the contract so it can pay out winners
    token_sac.mint(&admin, &100_000i128);
    flip_client.fund_house(&admin, &100_000i128);

    Setup {
        flip_client,
        rng_client,
        flip_id,
        admin,
        oracle,
        token_addr,
        token_sac,
    }
}

fn tc<'a>(env: &'a Env, token: &Address) -> TokenClient<'a> {
    TokenClient::new(env, token)
}

// -------------------------------------------------------------------
// 1. Initialization
// -------------------------------------------------------------------

#[test]
fn test_init_rejects_reinit() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let rng = Address::generate(&env);
    let tok = Address::generate(&env);
    let result = s
        .flip_client
        .try_init(&s.admin, &rng, &tok, &10, &1000, &250);
    assert!(result.is_err());
}

// -------------------------------------------------------------------
// 2. Place bet happy path
// -------------------------------------------------------------------

#[test]
fn test_place_bet_stores_game() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500);

    s.flip_client.place_bet(&player, &HEADS, &100, &1u64);

    let game = s.flip_client.get_game(&1u64);
    assert_eq!(game.player, player);
    assert_eq!(game.side, HEADS);
    assert_eq!(game.wager, 100);
    assert!(!game.resolved);
}

// -------------------------------------------------------------------
// 3. Resolve win path
// -------------------------------------------------------------------

#[test]
fn test_resolve_win() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500);

    // Place bet on Heads (0)
    s.flip_client.place_bet(&player, &HEADS, &100, &1u64);

    // Fulfill RNG — we need to find a seed that gives result 0 (Heads)
    // result = sha256(seed || request_id)[0..8] % 2
    // Try seeds until we get 0
    let mut winning_seed = seed(&env, 0);
    for i in 0u8..=255 {
        let test_seed = seed(&env, i);
        let result = derive_rng_result(&env, &test_seed, 1u64, 2);
        if result == 0 {
            winning_seed = test_seed;
            break;
        }
    }

    s.rng_client
        .fulfill_random(&s.oracle, &s.flip_id, &1u64, &winning_seed);
    s.flip_client.resolve_bet(&1u64);

    let game = s.flip_client.get_game(&1u64);
    assert!(game.resolved);
    assert!(game.won);
    // Payout = 2 * 100 - (100 * 250 / 10000) = 200 - 2 = 198
    assert_eq!(game.payout, 198);

    // Player should have received payout
    assert_eq!(tc(&env, &s.token_addr).balance(&player), 598); // 500 - 100 + 198
}

// -------------------------------------------------------------------
// 4. Resolve loss path
// -------------------------------------------------------------------

#[test]
fn test_resolve_loss() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500);

    // With seed(0) and game_id 3, derive_rng_result produces 1 (Tails).
    // Player bet Heads (0), so they lose.
    let game_id = 3u64;
    s.flip_client.place_bet(&player, &HEADS, &100, &game_id);

    let losing_seed = seed(&env, 0);
    s.rng_client
        .fulfill_random(&s.oracle, &s.flip_id, &game_id, &losing_seed);
    s.flip_client.resolve_bet(&game_id);

    let game = s.flip_client.get_game(&game_id);
    assert!(game.resolved);
    assert!(!game.won);
    assert_eq!(game.payout, 0);

    // Player lost their wager
    assert_eq!(tc(&env, &s.token_addr).balance(&player), 400);
}

// -------------------------------------------------------------------
// 5. Duplicate game_id rejected
// -------------------------------------------------------------------

#[test]
fn test_duplicate_game_id_rejected() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500);

    s.flip_client.place_bet(&player, &HEADS, &100, &1u64);
    let result = s.flip_client.try_place_bet(&player, &TAILS, &100, &1u64);
    assert!(result.is_err());
}

// -------------------------------------------------------------------
// 6. Invalid side rejected
// -------------------------------------------------------------------

#[test]
fn test_invalid_side_rejected() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500);

    let result = s.flip_client.try_place_bet(&player, &2u32, &100, &1u64);
    assert!(result.is_err());
}

// -------------------------------------------------------------------
// 7. Wager limits enforced
// -------------------------------------------------------------------

#[test]
fn test_wager_too_low_rejected() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500);

    let result = s.flip_client.try_place_bet(&player, &HEADS, &5, &1u64); // min is 10
    assert!(result.is_err());
}

#[test]
fn test_wager_too_high_rejected() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &5000);

    let result = s.flip_client.try_place_bet(&player, &HEADS, &1001, &1u64); // max is 1000
    assert!(result.is_err());
}

#[test]
fn test_zero_wager_rejected() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    let result = s.flip_client.try_place_bet(&player, &HEADS, &0, &1u64);
    assert!(result.is_err());
}

// -------------------------------------------------------------------
// 8. Resolve before RNG fulfillment rejected
// -------------------------------------------------------------------

#[test]
fn test_resolve_before_rng_rejected() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500);

    s.flip_client.place_bet(&player, &HEADS, &100, &1u64);

    // Don't fulfill RNG — try to resolve
    let result = s.flip_client.try_resolve_bet(&1u64);
    assert!(result.is_err());
}

// -------------------------------------------------------------------
// 9. Double resolution rejected
// -------------------------------------------------------------------

#[test]
fn test_double_resolve_rejected() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500);

    s.flip_client.place_bet(&player, &HEADS, &100, &1u64);

    let rng_seed = seed(&env, 0);
    s.rng_client
        .fulfill_random(&s.oracle, &s.flip_id, &1u64, &rng_seed);
    s.flip_client.resolve_bet(&1u64);

    let result = s.flip_client.try_resolve_bet(&1u64);
    assert!(result.is_err());
}

// -------------------------------------------------------------------
// 10. Game not found
// -------------------------------------------------------------------

#[test]
fn test_get_nonexistent_game() {
    let env = Env::default();
    let s = setup(&env);

    let result = s.flip_client.try_get_game(&99u64);
    assert!(result.is_err());
}

// -------------------------------------------------------------------
// 11. Multiple independent games
// -------------------------------------------------------------------

#[test]
fn test_multiple_games() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    s.token_sac.mint(&player1, &500);
    s.token_sac.mint(&player2, &500);

    s.flip_client.place_bet(&player1, &HEADS, &100, &10u64);
    s.flip_client.place_bet(&player2, &TAILS, &200, &20u64);

    let g1 = s.flip_client.get_game(&10u64);
    let g2 = s.flip_client.get_game(&20u64);
    assert_eq!(g1.player, player1);
    assert_eq!(g2.player, player2);
    assert_eq!(g1.wager, 100);
    assert_eq!(g2.wager, 200);
}

#[test]
fn test_recent_history_empty() {
    let env = Env::default();
    let s = setup(&env);
    let player = Address::generate(&env);

    let history = s.flip_client.get_recent_games(&player, &0, &5);
    assert_eq!(history.total, 0);
    assert_eq!(history.game_ids.len(), 0);
}

#[test]
fn test_recent_history_ordering() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &1_000);

    s.flip_client.place_bet(&player, &HEADS, &100, &11u64);
    s.flip_client.place_bet(&player, &TAILS, &100, &12u64);
    s.flip_client.place_bet(&player, &HEADS, &100, &13u64);

    let history = s.flip_client.get_recent_games(&player, &0, &10);
    assert_eq!(history.total, 3);
    assert_eq!(history.game_ids.get(0), Some(13u64));
    assert_eq!(history.game_ids.get(1), Some(12u64));
    assert_eq!(history.game_ids.get(2), Some(11u64));
}

#[test]
fn test_recent_history_retention_limit() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &5_000);

    for game_id in 1u64..=12 {
        s.flip_client.place_bet(&player, &HEADS, &100, &game_id);
    }

    let history = s.flip_client.get_recent_games(&player, &0, &20);
    assert_eq!(history.total, PLAYER_HISTORY_LIMIT);
    assert_eq!(history.game_ids.len(), PLAYER_HISTORY_LIMIT);
    assert_eq!(history.game_ids.get(0), Some(12u64));
    assert_eq!(history.game_ids.get(9), Some(3u64));
}

// -------------------------------------------------------------------
// Helper: reproduce RNG derivation for test seed selection
// -------------------------------------------------------------------

fn derive_rng_result(env: &Env, server_seed: &BytesN<32>, request_id: u64, max: u64) -> u64 {
    use soroban_sdk::Bytes;
    let mut preimage = [0u8; 40];
    preimage[..32].copy_from_slice(&server_seed.to_array());
    preimage[32..].copy_from_slice(&request_id.to_be_bytes());
    let digest: BytesN<32> = env
        .crypto()
        .sha256(&Bytes::from_slice(env, &preimage))
        .into();
    let arr = digest.to_array();
    let raw = u64::from_be_bytes([
        arr[0], arr[1], arr[2], arr[3], arr[4], arr[5], arr[6], arr[7],
    ]);
    raw % max
}

// -------------------------------------------------------------------
// House exposure snapshot tests
// -------------------------------------------------------------------

#[test]
fn test_exposure_snapshot_empty() {
    let env = Env::default();
    let s = setup(&env);
    let snap = s.flip_client.house_exposure_snapshot();
    assert_eq!(snap.active_game_count, 0);
    assert_eq!(snap.total_wagered, 0);
    assert_eq!(snap.max_payout_liability, 0);
}

#[test]
fn test_exposure_snapshot_single_active_game() {
    let env = Env::default();
    let s = setup(&env);
    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500i128);

    s.flip_client.place_bet(&player, &HEADS, &100, &1u64);

    let snap = s.flip_client.house_exposure_snapshot();
    assert_eq!(snap.active_game_count, 1);
    assert_eq!(snap.total_wagered, 100);
    // max_payout = 100 * (20_000 - 250) / 10_000 = 1_975_000 / 10_000 = 197
    // (conservative integer division; actual resolve payout may be 198)
    assert_eq!(snap.max_payout_liability, 197);
}

#[test]
fn test_exposure_snapshot_multi_game_aggregation() {
    let env = Env::default();
    let s = setup(&env);
    let p1 = Address::generate(&env);
    let p2 = Address::generate(&env);
    s.token_sac.mint(&p1, &500i128);
    s.token_sac.mint(&p2, &500i128);

    s.flip_client.place_bet(&p1, &HEADS, &100, &1u64);
    s.flip_client.place_bet(&p2, &TAILS, &200, &2u64);

    let snap = s.flip_client.house_exposure_snapshot();
    assert_eq!(snap.active_game_count, 2);
    assert_eq!(snap.total_wagered, 300);
    // max_payout = 300 * 19_750 / 10_000 = 592 (integer division)
    assert_eq!(snap.max_payout_liability, 592);
}

#[test]
fn test_exposure_snapshot_resets_after_resolve() {
    let env = Env::default();
    let s = setup(&env);
    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500i128);

    s.flip_client.place_bet(&player, &HEADS, &100, &42u64);

    let before = s.flip_client.house_exposure_snapshot();
    assert_eq!(before.active_game_count, 1);

    // Fulfill RNG and resolve so the exposure counter decrements
    let srv = seed(&env, 0);
    s.rng_client
        .fulfill_random(&s.oracle, &s.flip_id, &42u64, &srv);
    s.flip_client.resolve_bet(&42u64);

    let after = s.flip_client.house_exposure_snapshot();
    assert_eq!(after.active_game_count, 0);
    assert_eq!(after.total_wagered, 0);
    assert_eq!(after.max_payout_liability, 0);
}

// -------------------------------------------------------------------
// House Bankroll & Liquidity Tests (#1375)
// -------------------------------------------------------------------

#[test]
fn test_insufficient_house_liquidity_rejected() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let oracle = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token_addr, token_sac) = create_token(&env, &token_admin);

    let rng_id = env.register(RandomGenerator, ());
    let rng_client = RngTestClient::new(&env, &rng_id);

    let flip_id = env.register(CoinFlip, ());
    let flip_client = CoinFlipClient::new(&env, &flip_id);

    env.mock_all_auths();

    rng_client.init(&admin, &oracle);
    rng_client.authorize(&admin, &flip_id);

    // Commit seeds
    let mut commitments = soroban_sdk::Vec::new(&env);
    commitments.push_back(
        env.crypto()
            .sha256(&soroban_sdk::Bytes::from_slice(
                &env,
                &seed(&env, 0).to_array(),
            ))
            .into(),
    );
    rng_client.commit_seeds(&oracle, &commitments);

    flip_client.init(&admin, &rng_id, &token_addr, &10i128, &1000i128, &250i128);

    // House has 0 balance! Bet wager 100 has liability 197. Total available would be 100 < 197.
    let player = Address::generate(&env);
    token_sac.mint(&player, &500i128);

    let res = flip_client.try_place_bet(&player, &HEADS, &100i128, &1u64);
    assert_eq!(res, Err(Ok(Error::InsufficientHouseLiquidity)));

    // Player balance must be completely unchanged
    assert_eq!(tc(&env, &token_addr).balance(&player), 500i128);
}

#[test]
fn test_exact_house_liquidity_accepted() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let oracle = Address::generate(&env);
    let token_admin = Address::generate(&env);

    let (token_addr, token_sac) = create_token(&env, &token_admin);

    let rng_id = env.register(RandomGenerator, ());
    let rng_client = RngTestClient::new(&env, &rng_id);

    let flip_id = env.register(CoinFlip, ());
    let flip_client = CoinFlipClient::new(&env, &flip_id);

    env.mock_all_auths();

    rng_client.init(&admin, &oracle);
    rng_client.authorize(&admin, &flip_id);

    let mut commitments = soroban_sdk::Vec::new(&env);
    commitments.push_back(
        env.crypto()
            .sha256(&soroban_sdk::Bytes::from_slice(
                &env,
                &seed(&env, 0).to_array(),
            ))
            .into(),
    );
    rng_client.commit_seeds(&oracle, &commitments);

    flip_client.init(&admin, &rng_id, &token_addr, &10i128, &1000i128, &250i128);

    // For wager 100 with house edge 250 bps, max liability is 197.
    // If house has exactly 97, available = 97 + 100 = 197 == liability.
    token_sac.mint(&admin, &97i128);
    flip_client.fund_house(&admin, &97i128);

    let player = Address::generate(&env);
    token_sac.mint(&player, &500i128);

    let res = flip_client.try_place_bet(&player, &HEADS, &100i128, &1u64);
    assert!(res.is_ok());
    assert_eq!(tc(&env, &token_addr).balance(&player), 400i128);
}

#[test]
fn test_withdraw_house_below_liability_rejected() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500i128);
    s.flip_client.place_bet(&player, &HEADS, &100i128, &1u64);

    let snap = s.flip_client.house_exposure_snapshot();
    let liability = snap.max_payout_liability; // 197
    let balance = s.flip_client.house_balance();

    // Withdrawing more than (balance - liability) must fail
    let excessive_withdrawal = balance - liability + 1;
    let res = s
        .flip_client
        .try_withdraw_house(&s.admin, &excessive_withdrawal);
    assert_eq!(res, Err(Ok(Error::InsufficientHouseLiquidity)));

    // Withdrawing within safe margin succeeds
    let safe_withdrawal = balance - liability;
    let safe_res = s.flip_client.try_withdraw_house(&s.admin, &safe_withdrawal);
    assert!(safe_res.is_ok());
}

#[test]
fn test_fund_and_resolve_win_payout() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    // Additional funding
    s.token_sac.mint(&s.admin, &5000i128);
    s.flip_client.fund_house(&s.admin, &5000i128);

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500i128);

    s.flip_client.place_bet(&player, &HEADS, &100i128, &1u64);

    // Winning seed with game_id 1 is seed(0)
    let win_seed = seed(&env, 0);
    s.rng_client
        .fulfill_random(&s.oracle, &s.flip_id, &1u64, &win_seed);
    s.flip_client.resolve_bet(&1u64);

    let game = s.flip_client.get_game(&1u64);
    assert!(game.won);
    assert_eq!(tc(&env, &s.token_addr).balance(&player), 598i128);
}

#[test]
fn test_non_admin_fund_and_withdraw_rejected() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let impostor = Address::generate(&env);
    s.token_sac.mint(&impostor, &1000i128);

    let fund_res = s.flip_client.try_fund_house(&impostor, &100i128);
    assert_eq!(fund_res, Err(Ok(Error::NotAuthorized)));

    let withdraw_res = s.flip_client.try_withdraw_house(&impostor, &100i128);
    assert_eq!(withdraw_res, Err(Ok(Error::NotAuthorized)));
}

// -------------------------------------------------------------------
// Stale bet refunds (#1384)
// -------------------------------------------------------------------

const PLACED_AT: u32 = 1_000;

/// Place a 100-token Heads bet at ledger `PLACED_AT` for a fresh player
/// holding 500 tokens. Returns the player.
fn place_stale_candidate(env: &Env, s: &Setup, game_id: u64) -> Address {
    env.ledger().set_sequence_number(PLACED_AT);
    let player = Address::generate(env);
    s.token_sac.mint(&player, &500i128);
    s.flip_client.place_bet(&player, &HEADS, &100i128, &game_id);
    player
}

fn advance_past_timeout(env: &Env) {
    env.ledger()
        .set_sequence_number(PLACED_AT + DEFAULT_REFUND_TIMEOUT_LEDGERS);
}

#[test]
fn test_place_bet_records_placed_at_ledger() {
    let env = Env::default();
    let s = setup(&env);
    place_stale_candidate(&env, &s, 1u64);

    let game = s.flip_client.get_game(&1u64);
    assert_eq!(game.placed_at_ledger, PLACED_AT);
    assert!(!game.refunded);
}

#[test]
fn test_cancel_before_timeout_rejected() {
    let env = Env::default();
    let s = setup(&env);
    let player = place_stale_candidate(&env, &s, 1u64);
    let contract_before = s.flip_client.house_balance();

    // One ledger short of the timeout.
    env.ledger()
        .set_sequence_number(PLACED_AT + DEFAULT_REFUND_TIMEOUT_LEDGERS - 1);
    let res = s.flip_client.try_cancel_stale_bet(&player, &1u64);
    assert_eq!(res, Err(Ok(Error::RefundNotYetAvailable)));

    let game = s.flip_client.get_game(&1u64);
    assert!(!game.resolved);
    assert!(!game.refunded);
    assert_eq!(tc(&env, &s.token_addr).balance(&player), 400i128);
    assert_eq!(s.flip_client.house_balance(), contract_before);
    assert_eq!(s.flip_client.house_exposure_snapshot().active_game_count, 1);
}

#[test]
fn test_cancel_after_timeout_refunds_wager() {
    let env = Env::default();
    let s = setup(&env);
    let player = place_stale_candidate(&env, &s, 1u64);
    let contract_before = s.flip_client.house_balance();
    assert_eq!(tc(&env, &s.token_addr).balance(&player), 400i128);

    let snap = s.flip_client.house_exposure_snapshot();
    assert_eq!(snap.active_game_count, 1);
    assert_eq!(snap.total_wagered, 100);

    advance_past_timeout(&env);
    s.flip_client.cancel_stale_bet(&player, &1u64);

    // Exact wager returned to the player, taken from the contract.
    assert_eq!(tc(&env, &s.token_addr).balance(&player), 500i128);
    assert_eq!(s.flip_client.house_balance(), contract_before - 100);

    let game = s.flip_client.get_game(&1u64);
    assert!(game.resolved);
    assert!(game.refunded);
    assert!(!game.won);
    assert_eq!(game.payout, 0);

    let snap = s.flip_client.house_exposure_snapshot();
    assert_eq!(snap.active_game_count, 0);
    assert_eq!(snap.total_wagered, 0);
    assert_eq!(snap.max_payout_liability, 0);

    // A second cancel cannot refund again.
    let res = s.flip_client.try_cancel_stale_bet(&player, &1u64);
    assert_eq!(res, Err(Ok(Error::GameRefunded)));
    assert_eq!(tc(&env, &s.token_addr).balance(&player), 500i128);
}

#[test]
fn test_cancel_reduces_exposure_only_for_cancelled_game() {
    let env = Env::default();
    let s = setup(&env);
    let player = place_stale_candidate(&env, &s, 1u64);
    let other = Address::generate(&env);
    s.token_sac.mint(&other, &500i128);
    s.flip_client.place_bet(&other, &TAILS, &200i128, &2u64);

    advance_past_timeout(&env);
    s.flip_client.cancel_stale_bet(&player, &1u64);

    let snap = s.flip_client.house_exposure_snapshot();
    assert_eq!(snap.active_game_count, 1);
    assert_eq!(snap.total_wagered, 200);
}

#[test]
fn test_resolve_after_refund_rejected_even_if_rng_fulfilled() {
    let env = Env::default();
    let s = setup(&env);
    let player = place_stale_candidate(&env, &s, 1u64);

    advance_past_timeout(&env);
    s.flip_client.cancel_stale_bet(&player, &1u64);
    assert_eq!(tc(&env, &s.token_addr).balance(&player), 500i128);
    let contract_after_refund = s.flip_client.house_balance();

    // The oracle fulfills late with seed(0), which wins for Heads on game 1.
    s.rng_client
        .fulfill_random(&s.oracle, &s.flip_id, &1u64, &seed(&env, 0));
    assert_eq!(
        s.rng_client.get_result(&s.flip_id, &1u64).result,
        HEADS as u64
    );

    let res = s.flip_client.try_resolve_bet(&1u64);
    assert_eq!(res, Err(Ok(Error::GameRefunded)));

    // No payout on top of the refund.
    assert_eq!(tc(&env, &s.token_addr).balance(&player), 500i128);
    assert_eq!(s.flip_client.house_balance(), contract_after_refund);
    let game = s.flip_client.get_game(&1u64);
    assert!(game.refunded);
    assert!(!game.won);
    assert_eq!(game.payout, 0);
}

#[test]
fn test_cancel_resolved_game_rejected() {
    let env = Env::default();
    let s = setup(&env);
    let player = place_stale_candidate(&env, &s, 1u64);

    // seed(0) wins for Heads on game 1: payout 198.
    s.rng_client
        .fulfill_random(&s.oracle, &s.flip_id, &1u64, &seed(&env, 0));
    s.flip_client.resolve_bet(&1u64);
    assert_eq!(tc(&env, &s.token_addr).balance(&player), 598i128);

    advance_past_timeout(&env);
    let res = s.flip_client.try_cancel_stale_bet(&player, &1u64);
    assert_eq!(res, Err(Ok(Error::GameAlreadyResolved)));
    assert_eq!(tc(&env, &s.token_addr).balance(&player), 598i128);
    assert!(!s.flip_client.get_game(&1u64).refunded);
}

#[test]
fn test_cancel_rejected_when_rng_fulfilled_but_unresolved() {
    let env = Env::default();
    let s = setup(&env);
    let player = place_stale_candidate(&env, &s, 1u64);

    s.rng_client
        .fulfill_random(&s.oracle, &s.flip_id, &1u64, &seed(&env, 0));
    advance_past_timeout(&env);

    let res = s.flip_client.try_cancel_stale_bet(&player, &1u64);
    assert_eq!(res, Err(Ok(Error::RefundNotYetAvailable)));
    assert_eq!(tc(&env, &s.token_addr).balance(&player), 400i128);
    assert!(!s.flip_client.get_game(&1u64).refunded);

    // The game can still be settled normally.
    s.flip_client.resolve_bet(&1u64);
    assert_eq!(tc(&env, &s.token_addr).balance(&player), 598i128);
}

#[test]
fn test_cancel_by_non_player_rejected() {
    let env = Env::default();
    let s = setup(&env);
    let player = place_stale_candidate(&env, &s, 1u64);
    advance_past_timeout(&env);

    let attacker = Address::generate(&env);
    let res = s.flip_client.try_cancel_stale_bet(&attacker, &1u64);
    assert_eq!(res, Err(Ok(Error::NotAuthorized)));

    assert_eq!(tc(&env, &s.token_addr).balance(&attacker), 0i128);
    assert_eq!(tc(&env, &s.token_addr).balance(&player), 400i128);
    let game = s.flip_client.get_game(&1u64);
    assert!(!game.resolved);
    assert!(!game.refunded);
}

#[test]
fn test_cancel_without_player_auth_rejected() {
    let env = Env::default();
    let s = setup(&env);
    let player = place_stale_candidate(&env, &s, 1u64);
    advance_past_timeout(&env);

    // Drop the blanket auth mock: the player's signature is now missing.
    env.set_auths(&[]);
    let res = s.flip_client.try_cancel_stale_bet(&player, &1u64);
    assert!(res.is_err());

    assert_eq!(tc(&env, &s.token_addr).balance(&player), 400i128);
    assert!(!s.flip_client.get_game(&1u64).refunded);
}

// -------------------------------------------------------------------
// Instance storage TTL (#1385)
// -------------------------------------------------------------------

fn instance_ttl(env: &Env, contract_id: &Address) -> u32 {
    use soroban_sdk::testutils::storage::Instance as _;
    env.as_contract(contract_id, || env.storage().instance().get_ttl())
}

fn advance_ledgers(env: &Env, ledgers: u32) {
    env.ledger().with_mut(|l| l.sequence_number += ledgers);
}

/// Ledgers to advance so the instance TTL drops below the extension threshold
/// (but the persistent entries written by `setup` stay alive).
const DECAY: u32 = INSTANCE_BUMP_LEDGERS - INSTANCE_LIFETIME_THRESHOLD + 1_000;

#[test]
fn test_init_extends_instance_ttl() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let flip_id = env.register(CoinFlip, ());
    let flip_client = CoinFlipClient::new(&env, &flip_id);
    env.mock_all_auths();

    assert!(instance_ttl(&env, &flip_id) < INSTANCE_BUMP_LEDGERS);
    flip_client.init(
        &admin,
        &Address::generate(&env),
        &Address::generate(&env),
        &10i128,
        &1000i128,
        &250i128,
    );
    assert!(instance_ttl(&env, &flip_id) >= INSTANCE_BUMP_LEDGERS);
}

#[test]
fn test_state_changing_calls_extend_instance_ttl() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &10_000i128);

    // place_bet
    advance_ledgers(&env, DECAY);
    assert!(instance_ttl(&env, &s.flip_id) < INSTANCE_LIFETIME_THRESHOLD);
    s.flip_client.place_bet(&player, &HEADS, &100i128, &1u64);
    assert!(instance_ttl(&env, &s.flip_id) >= INSTANCE_BUMP_LEDGERS);

    // resolve_bet
    s.rng_client
        .fulfill_random(&s.oracle, &s.flip_id, &1u64, &seed(&env, 0));
    advance_ledgers(&env, DECAY);
    s.flip_client.resolve_bet(&1u64);
    assert!(instance_ttl(&env, &s.flip_id) >= INSTANCE_BUMP_LEDGERS);

    // fund_house
    s.token_sac.mint(&s.admin, &500i128);
    advance_ledgers(&env, DECAY);
    s.flip_client.fund_house(&s.admin, &500i128);
    assert!(instance_ttl(&env, &s.flip_id) >= INSTANCE_BUMP_LEDGERS);

    // withdraw_house
    advance_ledgers(&env, DECAY);
    s.flip_client.withdraw_house(&s.admin, &100i128);
    assert!(instance_ttl(&env, &s.flip_id) >= INSTANCE_BUMP_LEDGERS);

    // cancel_stale_bet (never fulfilled, past the refund timeout)
    s.flip_client.place_bet(&player, &HEADS, &100i128, &2u64);
    advance_ledgers(&env, DECAY.max(DEFAULT_REFUND_TIMEOUT_LEDGERS + 1));
    assert!(instance_ttl(&env, &s.flip_id) < INSTANCE_LIFETIME_THRESHOLD);
    s.flip_client.cancel_stale_bet(&player, &2u64);
    assert!(instance_ttl(&env, &s.flip_id) >= INSTANCE_BUMP_LEDGERS);
}

#[test]
fn test_contract_still_works_after_original_instance_ttl_passed() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &10_000i128);

    // TTL granted by setup's `init`; each call renews it.
    let original_ttl = instance_ttl(&env, &s.flip_id);

    // Step past the original expiry in two hops with a call in between.
    advance_ledgers(&env, original_ttl / 2 + 1_000);
    s.flip_client.place_bet(&player, &HEADS, &100i128, &1u64);
    advance_ledgers(&env, original_ttl / 2 + 1_000);

    s.rng_client
        .fulfill_random(&s.oracle, &s.flip_id, &1u64, &seed(&env, 0));
    s.flip_client.resolve_bet(&1u64);
    assert!(s.flip_client.get_game(&1u64).resolved);
    assert!(instance_ttl(&env, &s.flip_id) >= INSTANCE_BUMP_LEDGERS);
}

// -------------------------------------------------------------------
// RNG request IDs are namespaced per caller (#1386)
// -------------------------------------------------------------------

#[test]
fn test_game_id_does_not_collide_with_another_games_request_id() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    // A second authorised game (e.g. dice-roll) already used request_id 1.
    let other_game = Address::generate(&env);
    s.rng_client.authorize(&s.admin, &other_game);
    s.rng_client.request_random(&other_game, &1u64, &6u64);

    // Coin-flip game_id 1 still works end to end.
    let player = Address::generate(&env);
    s.token_sac.mint(&player, &1_000i128);
    s.flip_client.place_bet(&player, &HEADS, &100i128, &1u64);
    s.rng_client
        .fulfill_random(&s.oracle, &s.flip_id, &1u64, &seed(&env, 1));
    s.flip_client.resolve_bet(&1u64);
    assert!(s.flip_client.get_game(&1u64).resolved);
}

// -------------------------------------------------------------------
// Config & Pause Controls
// -------------------------------------------------------------------

#[test]
fn test_init_config_validation() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let rng_id = env.register(RandomGenerator, ());
    let (token_addr, _) = create_token(&env, &admin);
    env.mock_all_auths();

    // min_wager <= 0
    let flip_id1 = env.register(CoinFlip, ());
    let c1 = CoinFlipClient::new(&env, &flip_id1);
    assert_eq!(
        c1.try_init(&admin, &rng_id, &token_addr, &0i128, &100i128, &250i128),
        Err(Ok(Error::InvalidConfig))
    );

    // min_wager > max_wager
    let flip_id2 = env.register(CoinFlip, ());
    let c2 = CoinFlipClient::new(&env, &flip_id2);
    assert_eq!(
        c2.try_init(&admin, &rng_id, &token_addr, &200i128, &100i128, &250i128),
        Err(Ok(Error::InvalidConfig))
    );

    // house_edge_bps < 0
    let flip_id3 = env.register(CoinFlip, ());
    let c3 = CoinFlipClient::new(&env, &flip_id3);
    assert_eq!(
        c3.try_init(&admin, &rng_id, &token_addr, &10i128, &100i128, &-1i128),
        Err(Ok(Error::InvalidConfig))
    );

    // house_edge_bps >= 10_000
    let flip_id4 = env.register(CoinFlip, ());
    let c4 = CoinFlipClient::new(&env, &flip_id4);
    assert_eq!(
        c4.try_init(&admin, &rng_id, &token_addr, &10i128, &100i128, &10_000i128),
        Err(Ok(Error::InvalidConfig))
    );
}

#[test]
fn test_get_config_and_defaults() {
    let env = Env::default();
    let s = setup(&env);

    let config = s.flip_client.get_config();
    assert_eq!(config.admin, s.admin);
    assert_eq!(config.token, s.token_addr);
    assert_eq!(config.min_wager, 10i128);
    assert_eq!(config.max_wager, 1000i128);
    assert_eq!(config.house_edge_bps, 250i128);
    assert!(!config.paused);
    assert_eq!(
        config.refund_timeout_ledgers,
        DEFAULT_REFUND_TIMEOUT_LEDGERS
    );
    assert!(!s.flip_client.is_paused());
}

#[test]
fn test_set_wager_limits() {
    let env = Env::default();
    let s = setup(&env);

    // Valid update
    s.flip_client.set_wager_limits(&s.admin, &50i128, &2000i128);
    let cfg = s.flip_client.get_config();
    assert_eq!(cfg.min_wager, 50i128);
    assert_eq!(cfg.max_wager, 2000i128);

    // Invalid limits (min > max)
    assert_eq!(
        s.flip_client
            .try_set_wager_limits(&s.admin, &500i128, &200i128),
        Err(Ok(Error::InvalidConfig))
    );

    // Invalid limits (min <= 0)
    assert_eq!(
        s.flip_client
            .try_set_wager_limits(&s.admin, &0i128, &200i128),
        Err(Ok(Error::InvalidConfig))
    );

    // Non-admin rejected
    let attacker = Address::generate(&env);
    assert_eq!(
        s.flip_client
            .try_set_wager_limits(&attacker, &20i128, &500i128),
        Err(Ok(Error::NotAuthorized))
    );
}

#[test]
fn test_pause_and_unpause() {
    let env = Env::default();
    let s = setup(&env);

    assert!(!s.flip_client.is_paused());

    // Admin pauses
    s.flip_client.set_paused(&s.admin, &true);
    assert!(s.flip_client.is_paused());
    assert!(s.flip_client.get_config().paused);

    // Admin unpauses
    s.flip_client.set_paused(&s.admin, &false);
    assert!(!s.flip_client.is_paused());
    assert!(!s.flip_client.get_config().paused);

    // Non-admin rejected
    let attacker = Address::generate(&env);
    assert_eq!(
        s.flip_client.try_set_paused(&attacker, &true),
        Err(Ok(Error::NotAuthorized))
    );
}

#[test]
fn test_place_bet_blocked_when_paused() {
    let env = Env::default();
    let s = setup(&env);
    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500i128);

    s.flip_client.set_paused(&s.admin, &true);

    let res = s
        .flip_client
        .try_place_bet(&player, &HEADS, &100i128, &1u64);
    assert_eq!(res, Err(Ok(Error::Paused)));

    // Unpause and verify betting works
    s.flip_client.set_paused(&s.admin, &false);
    assert!(s
        .flip_client
        .try_place_bet(&player, &HEADS, &100i128, &1u64)
        .is_ok());
}

#[test]
fn test_resolve_and_cancel_work_while_paused() {
    let env = Env::default();
    let s = setup(&env);
    let player1 = Address::generate(&env);
    let player2 = Address::generate(&env);
    s.token_sac.mint(&player1, &500i128);
    s.token_sac.mint(&player2, &500i128);

    // Place bet 1
    s.flip_client.place_bet(&player1, &HEADS, &100i128, &1u64);

    // Place bet 2
    s.flip_client.place_bet(&player2, &HEADS, &100i128, &2u64);

    // Pause contract
    s.flip_client.set_paused(&s.admin, &true);

    // Resolve bet 1 while paused
    s.rng_client
        .fulfill_random(&s.oracle, &s.flip_id, &1u64, &seed(&env, 0));
    assert!(s.flip_client.try_resolve_bet(&1u64).is_ok());
    let g1 = s.flip_client.get_game(&1u64);
    assert!(g1.resolved);

    // Cancel stale bet 2 while paused
    advance_past_timeout(&env);
    assert!(s.flip_client.try_cancel_stale_bet(&player2, &2u64).is_ok());
    let g2 = s.flip_client.get_game(&2u64);
    assert!(g2.refunded);
}
