use super::*;
use soroban_sdk::{
    testutils::Address as _,
    token::{StellarAssetClient, TokenClient},
    Address, BytesN, Env,
};
use stellarcade_random_generator::{RandomGenerator, RandomGeneratorClient};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn create_token<'a>(env: &'a Env, admin: &Address) -> (Address, StellarAssetClient<'a>) {
    let contract = env.register_stellar_asset_contract_v2(admin.clone());
    let client = StellarAssetClient::new(env, &contract.address());
    (contract.address(), client)
}

fn make_seed(env: &Env, byte: u8) -> BytesN<32> {
    let mut arr = [0u8; 32];
    arr[31] = byte;
    BytesN::from_array(env, &arr)
}

/// Re-derive the RNG result the same way the Random Generator contract does,
/// so tests can select seeds that produce a specific secret number.
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

/// Compute the secret number that a given seed produces for a game range.
fn secret_for_seed(env: &Env, seed: &BytesN<32>, game_id: u64, min: u32, max: u32) -> u32 {
    let range_size = (max - min + 1) as u64;
    let rng_result = derive_rng_result(env, seed, game_id, range_size);
    min + rng_result as u32
}

struct Setup<'a> {
    ng_client: NumberGuessClient<'a>,
    ng_id: Address,
    rng_client: RandomGeneratorClient<'a>,
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

    // Deploy Random Generator
    let rng_id = env.register(RandomGenerator, ());
    let rng_client = RandomGeneratorClient::new(env, &rng_id);

    // Deploy NumberGuess
    let ng_id = env.register(NumberGuess, ());
    let ng_client = NumberGuessClient::new(env, &ng_id);

    env.mock_all_auths();

    // Init RNG; authorize the NumberGuess contract as a caller
    rng_client.init(&admin, &oracle);
    rng_client.authorize(&admin, &ng_id);

    // Pre-commit seed commitments so request_random can pop them
    let mut commitments = soroban_sdk::Vec::new(env);
    for i in 0..255u8 {
        let s = make_seed(env, i);
        let h: BytesN<32> = env
            .crypto()
            .sha256(&soroban_sdk::Bytes::from_slice(env, &s.to_array()))
            .into();
        commitments.push_back(h);
    }
    rng_client.commit_seeds(&oracle, &commitments);

    let prize_pool = Address::generate(env);

    // Init NumberGuess: min_wager=10, max_wager=10_000, house_edge=250 bps (2.5%)
    ng_client.init(
        &admin,
        &rng_id,
        &prize_pool,
        &token_addr,
        &10i128,
        &10_000i128,
        &250i128,
    );

    // Pre-fund the contract so it can pay out winners
    token_sac.mint(&ng_id, &1_000_000i128);

    Setup {
        ng_client,
        ng_id,
        rng_client,
        admin,
        oracle,
        token_addr,
        token_sac,
    }
}

fn tc<'a>(env: &'a Env, token: &Address) -> TokenClient<'a> {
    TokenClient::new(env, token)
}

// ---------------------------------------------------------------------------
// 1. Initialization
// ---------------------------------------------------------------------------

#[test]
fn test_init_rejects_reinit() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let rng = Address::generate(&env);
    let pp = Address::generate(&env);
    let tok = Address::generate(&env);
    let result = s
        .ng_client
        .try_init(&s.admin, &rng, &pp, &tok, &10, &10_000, &250);
    assert!(result.is_err());
}

// ---------------------------------------------------------------------------
// 2. start_game happy path
// ---------------------------------------------------------------------------

#[test]
fn test_start_game_stores_game() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500);

    s.ng_client
        .start_game(&player, &1u32, &10u32, &100i128, &1u64);

    let game = s.ng_client.get_game(&1u64);
    assert_eq!(game.player, player);
    assert_eq!(game.min, 1);
    assert_eq!(game.max, 10);
    assert_eq!(game.wager, 100);
    assert_eq!(game.status, GameStatus::Open);

    // Tokens transferred out of player
    assert_eq!(tc(&env, &s.token_addr).balance(&player), 400);
}

// ---------------------------------------------------------------------------
// 3. submit_guess happy path
// ---------------------------------------------------------------------------

#[test]
fn test_submit_guess_transitions_to_guessed() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500);

    s.ng_client
        .start_game(&player, &1u32, &10u32, &100i128, &1u64);
    s.ng_client.submit_guess(&1u64, &5u32);

    let game = s.ng_client.get_game(&1u64);
    assert_eq!(game.guess, 5);
    assert_eq!(game.status, GameStatus::Guessed);
}

// ---------------------------------------------------------------------------
// 4. Full win path
// ---------------------------------------------------------------------------

#[test]
fn test_win_path() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &1_000);

    let game_id: u64 = 42;
    let min = 1u32;
    let max = 10u32;
    let wager: i128 = 100;

    // The first request_random pops the first committed seed (index 0).
    let seed = make_seed(&env, 0);
    let secret = secret_for_seed(&env, &seed, game_id, min, max);

    s.ng_client
        .start_game(&player, &min, &max, &wager, &game_id);
    s.ng_client.submit_guess(&game_id, &secret);

    s.rng_client
        .fulfill_random(&s.oracle, &s.ng_id, &game_id, &seed);
    s.ng_client.resolve_game(&game_id);

    let game = s.ng_client.get_game(&game_id);
    assert_eq!(game.status, GameStatus::Won);
    assert_eq!(game.secret, secret);
    assert!(game.payout > 0);

    // gross_payout = 100 * 10 = 1000; fee = 1000 * 250 / 10000 = 25; net = 975
    assert_eq!(game.payout, 975);

    // Player balance: started with 1000, paid 100, received 975 → 1875
    assert_eq!(tc(&env, &s.token_addr).balance(&player), 1875);
}

// ---------------------------------------------------------------------------
// 5. Full loss path
// ---------------------------------------------------------------------------

#[test]
fn test_loss_path() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500);

    let game_id: u64 = 99;
    let min = 1u32;
    let max = 10u32;
    let wager: i128 = 100;

    // Use the first committed seed and pick a guess that won't match.
    let seed = make_seed(&env, 0);
    let secret = secret_for_seed(&env, &seed, game_id, min, max);
    let guess = if secret == min { max } else { min };

    s.ng_client
        .start_game(&player, &min, &max, &wager, &game_id);
    s.ng_client.submit_guess(&game_id, &guess);

    s.rng_client
        .fulfill_random(&s.oracle, &s.ng_id, &game_id, &seed);
    s.ng_client.resolve_game(&game_id);

    let game = s.ng_client.get_game(&game_id);
    assert_eq!(game.status, GameStatus::Lost);
    assert_eq!(game.payout, 0);

    // Player lost wager: 500 - 100 = 400
    assert_eq!(tc(&env, &s.token_addr).balance(&player), 400);
}

// ---------------------------------------------------------------------------
// 6. Duplicate game_id rejected
// ---------------------------------------------------------------------------

#[test]
fn test_duplicate_game_id_rejected() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &1_000);

    s.ng_client
        .start_game(&player, &1u32, &10u32, &100i128, &1u64);
    let result = s
        .ng_client
        .try_start_game(&player, &1u32, &10u32, &100i128, &1u64);
    assert!(result.is_err());
}

// ---------------------------------------------------------------------------
// 7. Invalid range rejected
// ---------------------------------------------------------------------------

#[test]
fn test_invalid_range_min_equals_max() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500);

    let result = s
        .ng_client
        .try_start_game(&player, &5u32, &5u32, &100i128, &1u64);
    assert!(result.is_err());
}

#[test]
fn test_invalid_range_min_greater_than_max() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500);

    let result = s
        .ng_client
        .try_start_game(&player, &10u32, &5u32, &100i128, &1u64);
    assert!(result.is_err());
}

// ---------------------------------------------------------------------------
// 8. Wager limits enforced
// ---------------------------------------------------------------------------

#[test]
fn test_wager_too_low_rejected() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500);

    // min_wager = 10
    let result = s
        .ng_client
        .try_start_game(&player, &1u32, &10u32, &5i128, &1u64);
    assert!(result.is_err());
}

#[test]
fn test_wager_too_high_rejected() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &100_000);

    // max_wager = 10_000
    let result = s
        .ng_client
        .try_start_game(&player, &1u32, &10u32, &10_001i128, &1u64);
    assert!(result.is_err());
}

#[test]
fn test_zero_wager_rejected() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    let result = s
        .ng_client
        .try_start_game(&player, &1u32, &10u32, &0i128, &1u64);
    assert!(result.is_err());
}

// ---------------------------------------------------------------------------
// 9. Guess out of range rejected
// ---------------------------------------------------------------------------

#[test]
fn test_guess_below_min_rejected() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500);

    s.ng_client
        .start_game(&player, &5u32, &15u32, &100i128, &1u64);
    // Guess of 4 is below min=5
    let result = s.ng_client.try_submit_guess(&1u64, &4u32);
    assert!(result.is_err());
}

#[test]
fn test_guess_above_max_rejected() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500);

    s.ng_client
        .start_game(&player, &5u32, &15u32, &100i128, &1u64);
    // Guess of 16 is above max=15
    let result = s.ng_client.try_submit_guess(&1u64, &16u32);
    assert!(result.is_err());
}

// ---------------------------------------------------------------------------
// 10. Double guess rejected
// ---------------------------------------------------------------------------

#[test]
fn test_double_guess_rejected() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500);

    s.ng_client
        .start_game(&player, &1u32, &10u32, &100i128, &1u64);
    s.ng_client.submit_guess(&1u64, &5u32);

    let result = s.ng_client.try_submit_guess(&1u64, &7u32);
    assert!(result.is_err());
}

// ---------------------------------------------------------------------------
// 11. Double resolve rejected
// ---------------------------------------------------------------------------

#[test]
fn test_double_resolve_rejected() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500);

    let game_id: u64 = 1;
    s.ng_client
        .start_game(&player, &1u32, &10u32, &100i128, &game_id);
    s.ng_client.submit_guess(&game_id, &5u32);

    let seed = make_seed(&env, 0);
    s.rng_client
        .fulfill_random(&s.oracle, &s.ng_id, &game_id, &seed);
    s.ng_client.resolve_game(&game_id);

    let result = s.ng_client.try_resolve_game(&game_id);
    assert!(result.is_err());
}

// ---------------------------------------------------------------------------
// 12. Resolve before guess rejected
// ---------------------------------------------------------------------------

#[test]
fn test_resolve_before_guess_rejected() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500);

    let game_id: u64 = 1;
    s.ng_client
        .start_game(&player, &1u32, &10u32, &100i128, &game_id);
    // No submit_guess call

    let seed = make_seed(&env, 0);
    s.rng_client
        .fulfill_random(&s.oracle, &s.ng_id, &game_id, &seed);

    let result = s.ng_client.try_resolve_game(&game_id);
    assert!(result.is_err());
}

// ---------------------------------------------------------------------------
// 13. Resolve before RNG fulfillment rejected
// ---------------------------------------------------------------------------

#[test]
fn test_resolve_before_rng_rejected() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500);

    let game_id: u64 = 1;
    s.ng_client
        .start_game(&player, &1u32, &10u32, &100i128, &game_id);
    s.ng_client.submit_guess(&game_id, &5u32);
    // No RNG fulfillment

    let result = s.ng_client.try_resolve_game(&game_id);
    assert!(result.is_err());
}

// ---------------------------------------------------------------------------
// 14. get_game on nonexistent game returns error
// ---------------------------------------------------------------------------

#[test]
fn test_get_nonexistent_game_returns_error() {
    let env = Env::default();
    let s = setup(&env);

    let result = s.ng_client.try_get_game(&999u64);
    assert!(result.is_err());
}

// ---------------------------------------------------------------------------
// 15. Multiple independent games
// ---------------------------------------------------------------------------

#[test]
fn test_multiple_games_independent() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let p1 = Address::generate(&env);
    let p2 = Address::generate(&env);
    s.token_sac.mint(&p1, &1_000);
    s.token_sac.mint(&p2, &1_000);

    s.ng_client.start_game(&p1, &1u32, &10u32, &100i128, &10u64);
    s.ng_client
        .start_game(&p2, &50u32, &100u32, &200i128, &20u64);

    let g1 = s.ng_client.get_game(&10u64);
    let g2 = s.ng_client.get_game(&20u64);

    assert_eq!(g1.player, p1);
    assert_eq!(g2.player, p2);
    assert_eq!(g1.min, 1);
    assert_eq!(g2.min, 50);
    assert_eq!(g1.wager, 100);
    assert_eq!(g2.wager, 200);
    assert_eq!(g1.status, GameStatus::Open);
    assert_eq!(g2.status, GameStatus::Open);
}

// ---------------------------------------------------------------------------
// 16. Payout formula correctness (range=2, house_edge=250bps)
// ---------------------------------------------------------------------------

#[test]
fn test_payout_formula_range_two() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &1_000);

    let game_id: u64 = 200;
    let min = 1u32;
    let max = 2u32;
    let wager: i128 = 1_000;

    // First committed seed; compute secret and guess it to win.
    let seed = make_seed(&env, 0);
    let secret = secret_for_seed(&env, &seed, game_id, min, max);

    s.ng_client
        .start_game(&player, &min, &max, &wager, &game_id);
    s.ng_client.submit_guess(&game_id, &secret);

    s.rng_client
        .fulfill_random(&s.oracle, &s.ng_id, &game_id, &seed);
    s.ng_client.resolve_game(&game_id);

    let game = s.ng_client.get_game(&game_id);
    // gross = 1000 * 2 = 2000; fee = 2000 * 250 / 10000 = 50; net = 1950
    assert_eq!(game.payout, 1950);
    assert_eq!(game.status, GameStatus::Won);
}

// ---------------------------------------------------------------------------
// 17. Boundary guess at min is accepted
// ---------------------------------------------------------------------------

#[test]
fn test_boundary_guess_at_min() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500);

    s.ng_client
        .start_game(&player, &1u32, &100u32, &100i128, &1u64);
    s.ng_client.submit_guess(&1u64, &1u32); // guess == min

    let game = s.ng_client.get_game(&1u64);
    assert_eq!(game.guess, 1);
    assert_eq!(game.status, GameStatus::Guessed);
}

// ---------------------------------------------------------------------------
// 18. Boundary guess at max is accepted
// ---------------------------------------------------------------------------

#[test]
fn test_boundary_guess_at_max() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500);

    s.ng_client
        .start_game(&player, &1u32, &100u32, &100i128, &1u64);
    s.ng_client.submit_guess(&1u64, &100u32); // guess == max

    let game = s.ng_client.get_game(&1u64);
    assert_eq!(game.guess, 100);
    assert_eq!(game.status, GameStatus::Guessed);
}

// ---------------------------------------------------------------------------
// 19. Range size cap enforced (MAX_RANGE_SIZE)
// ---------------------------------------------------------------------------

#[test]
fn test_range_size_cap_enforced() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &500);

    // Range size = MAX_RANGE_SIZE + 1 → must be rejected
    let oversized_max = MAX_RANGE_SIZE; // min=0+1, max=MAX_RANGE_SIZE → size = MAX_RANGE_SIZE
    let result = s
        .ng_client
        .try_start_game(&player, &1u32, &(oversized_max + 1), &100i128, &1u64);
    assert!(result.is_err());
}

// ---------------------------------------------------------------------------
// 20. Secret number falls within [min, max] for all seeds
// ---------------------------------------------------------------------------

#[test]
fn test_secret_always_in_range() {
    let env = Env::default();
    let s = setup(&env);
    env.mock_all_auths();

    let player = Address::generate(&env);
    s.token_sac.mint(&player, &100_000);

    let min: u32 = 5;
    let max: u32 = 15;

    for i in 0u64..20 {
        let wager: i128 = 10;
        let game_id = 1000 + i;

        // Each request_random pops the next committed seed in FIFO order.
        let seed = make_seed(&env, i as u8);
        let secret = secret_for_seed(&env, &seed, game_id, min, max);

        s.ng_client
            .start_game(&player, &min, &max, &wager, &game_id);
        s.ng_client.submit_guess(&game_id, &min); // always guess min

        s.rng_client
            .fulfill_random(&s.oracle, &s.ng_id, &game_id, &seed);
        s.ng_client.resolve_game(&game_id);

        let game = s.ng_client.get_game(&game_id);
        assert!(
            game.secret >= min && game.secret <= max,
            "secret {} outside [{}, {}] for game_id {}",
            game.secret,
            min,
            max,
            game_id
        );
        assert_eq!(game.secret, secret);
    }
}
