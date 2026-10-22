#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, Env};

struct Setup {
    env: Env,
    client: QuestRedeemerClient<'static>,
    admin: Address,
    quest_board: Address,
    token: Address,
}

fn setup() -> Setup {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(QuestRedeemer, ());
    let client = QuestRedeemerClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let quest_board = Address::generate(&env);
    let token = Address::generate(&env);

    let client: QuestRedeemerClient<'static> = unsafe { core::mem::transmute(client) };

    Setup {
        env,
        client,
        admin,
        quest_board,
        token,
    }
}

#[test]
fn test_init_and_snapshot() {
    let s = setup();
    s.client.init(&s.admin, &s.quest_board, &s.token);

    let user = Address::generate(&s.env);
    let snapshot = s.client.get_redemption_snapshot(&user, &1);

    assert!(matches!(snapshot.config, OptionalRedeemerConfig::Some(_)));
    assert_eq!(snapshot.status, RedemptionStatus::Eligible);
    assert!(!s.client.is_paused());
}

#[test]
fn test_redeem_and_query() {
    let s = setup();
    s.client.init(&s.admin, &s.quest_board, &s.token);

    let user = Address::generate(&s.env);
    s.client.redeem(&user, &42);

    assert!(s.client.has_redeemed(&user, &42));
    assert!(!s.client.has_redeemed(&user, &43));

    let snapshot = s.client.get_redemption_snapshot(&user, &42);
    assert_eq!(snapshot.status, RedemptionStatus::Redeemed);
}

#[test]
fn test_paused_redemption() {
    let s = setup();
    s.client.init(&s.admin, &s.quest_board, &s.token);

    s.client.set_pause(&true);
    let user = Address::generate(&s.env);

    let snapshot = s.client.get_redemption_snapshot(&user, &1);
    assert_eq!(snapshot.status, RedemptionStatus::Paused);

    let result = s.client.try_redeem(&user, &1);
    assert!(result.is_err());
}

#[test]
fn test_uninitialized_reads() {
    let env = Env::default();
    let contract_id = env.register(QuestRedeemer, ());
    let client = QuestRedeemerClient::new(&env, &contract_id);
    let user = Address::generate(&env);

    let snapshot = client.get_redemption_snapshot(&user, &1);
    assert_eq!(snapshot.config, OptionalRedeemerConfig::None);
    assert_eq!(snapshot.status, RedemptionStatus::Paused);
}

#[test]
fn test_turn_in_queue_summary_uninitialized_has_no_config() {
    let env = Env::default();
    let contract_id = env.register(QuestRedeemer, ());
    let client = QuestRedeemerClient::new(&env, &contract_id);
    let user = Address::generate(&env);

    let summary = client.turn_in_queue_summary(&user, &1);
    assert_eq!(summary.config, OptionalRedeemerConfig::None);
    assert_eq!(summary.status, RedemptionStatus::Paused);
}

#[test]
fn test_reward_gap_uninitialized_has_no_config() {
    let env = Env::default();
    let contract_id = env.register(QuestRedeemer, ());
    let client = QuestRedeemerClient::new(&env, &contract_id);
    let user = Address::generate(&env);

    let gap = client.reward_gap(&user, &1);
    assert_eq!(gap.config, OptionalRedeemerConfig::None);
    assert_eq!(gap.reward_gap, 1);
    assert!(!gap.ready_to_turn_in);
}

#[test]
fn test_reward_gap_initialized_carries_config() {
    let s = setup();
    s.client.init(&s.admin, &s.quest_board, &s.token);
    let user = Address::generate(&s.env);

    let gap = s.client.reward_gap(&user, &1);
    assert!(matches!(gap.config, OptionalRedeemerConfig::Some(_)));
    assert_eq!(gap.reward_gap, 0);
}
