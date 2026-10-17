#![no_std]

mod storage;
#[cfg(test)]
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, Address, Env, Symbol};
pub use types::{FallbackBucket, RouteData, RouteImbalanceSummary, RoutingStateSnapshot};

#[contract]
pub struct RewardRouter;

#[contractimpl]
impl RewardRouter {
    /// Initialize the contract with an admin.
    pub fn init(env: Env, admin: Address) {
        if storage::get_admin(&env).is_some() {
            panic!("Already initialized");
        }
        storage::set_admin(&env, &admin);
    }

    /// Return the imbalance summary for a specific route.
    /// If the route does not exist, returns a zeroed summary.
    pub fn route_imbalance_summary(env: Env, route_id: Symbol) -> RouteImbalanceSummary {
        let route = storage::get_route(&env, &route_id).unwrap_or(RouteData {
            allocated: 0,
            routed: 0,
        });

        let imbalance = route.allocated - route.routed;

        RouteImbalanceSummary {
            route_id,
            total_allocated: route.allocated,
            total_routed: route.routed,
            imbalance,
            is_balanced: imbalance == 0,
        }
    }

    /// Return the fallback bucket details.
    /// Returns None if fallback is not configured.
    pub fn fallback_bucket(env: Env) -> Option<FallbackBucket> {
        storage::get_fallback(&env)
    }

    /// Configure the fallback bucket. Admin only.
    pub fn set_fallback(env: Env, admin: Address, bucket_address: Address) {
        admin.require_auth();
        let stored_admin = storage::get_admin(&env).expect("Not initialized");
        assert!(admin == stored_admin, "Unauthorized");

        let current = storage::get_fallback(&env).unwrap_or(FallbackBucket {
            bucket_address: bucket_address.clone(),
            total_collected: 0,
            last_fallback_ledger: 0,
        });

        storage::set_fallback(
            &env,
            &FallbackBucket {
                bucket_address,
                total_collected: current.total_collected,
                last_fallback_ledger: env.ledger().sequence(),
            },
        );
    }

    /// Add or update a route's allocation. Admin only.
    pub fn update_route(env: Env, admin: Address, route_id: Symbol, allocated: i128) {
        admin.require_auth();
        let stored_admin = storage::get_admin(&env).expect("Not initialized");
        assert!(admin == stored_admin, "Unauthorized");

        let mut route = storage::get_route(&env, &route_id).unwrap_or(RouteData {
            allocated: 0,
            routed: 0,
        });

        route.allocated = allocated;
        storage::set_route(&env, &route_id, &route);
        storage::add_route_id(&env, &route_id);
    }

    /// Return the split ratio for a specific route in basis points.
    ///
    /// `split_ratio_bps = routed * 10_000 / allocated`, floored to 0 when
    /// `allocated == 0` or the route does not exist.
    pub fn split_ratio(env: Env, route_id: Symbol) -> u32 {
        let route = storage::get_route(&env, &route_id).unwrap_or(RouteData {
            allocated: 0,
            routed: 0,
        });
        if route.allocated == 0 {
            return 0;
        }
        ((route.routed * 10_000) / route.allocated) as u32
    }

    /// Return an aggregate snapshot of routing state across all tracked routes.
    ///
    /// `split_ratio_bps` reflects what fraction of total allocated rewards have
    /// been routed: `total_routed * 10_000 / total_allocated`. Returns zeroed
    /// snapshot before any routes are configured.
    pub fn routing_state_snapshot(env: Env) -> RoutingStateSnapshot {
        let ids = storage::get_route_ids(&env);
        let mut total_allocated: i128 = 0;
        let mut total_routed: i128 = 0;

        for route_id in ids.iter() {
            if let Some(route) = storage::get_route(&env, &route_id) {
                total_allocated = total_allocated.saturating_add(route.allocated);
                total_routed = total_routed.saturating_add(route.routed);
            }
        }

        let total_imbalance = total_allocated.saturating_sub(total_routed);
        let split_ratio_bps = if total_allocated == 0 {
            0
        } else {
            ((total_routed * 10_000) / total_allocated) as u32
        };

        let fallback = storage::get_fallback(&env);
        let fallback_collected = fallback.as_ref().map(|f| f.total_collected).unwrap_or(0);

        RoutingStateSnapshot {
            total_allocated,
            total_routed,
            total_imbalance,
            split_ratio_bps,
            fallback_collected,
            has_fallback: fallback.is_some(),
        }
    }

    /// Route a reward. Updates routed amount or collects in fallback if route missing.
    pub fn route_reward(env: Env, route_id: Symbol, amount: i128) {
        if let Some(mut route) = storage::get_route(&env, &route_id) {
            route.routed += amount;
            storage::set_route(&env, &route_id, &route);
        } else if let Some(mut fallback) = storage::get_fallback(&env) {
            fallback.total_collected += amount;
            fallback.last_fallback_ledger = env.ledger().sequence();
            storage::set_fallback(&env, &fallback);
        }
    }
}
