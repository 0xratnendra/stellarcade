#![no_std]

mod storage;
#[cfg(test)]
mod test;
mod types;

use soroban_sdk::{contract, contractimpl, Address, Env, Vec};
pub use types::{
    LobbyConfigSnapshot, LobbyData, Participant, ReadyCheckSummary, SeatAvailability,
    StartGraceConfig,
};

#[contract]
pub struct TournamentLobby;

#[contractimpl]
impl TournamentLobby {
    /// Initialize the contract with an admin.
    pub fn init(env: Env, admin: Address) {
        if storage::get_admin(&env).is_some() {
            panic!("Already initialized");
        }
        storage::set_admin(&env, &admin);
    }

    /// Return the ready-check summary for a specific lobby.
    pub fn ready_check_summary(env: Env, lobby_id: u64) -> ReadyCheckSummary {
        let lobby = storage::get_lobby(&env, lobby_id).unwrap_or(LobbyData {
            max_seats: 0,
            participants: Vec::new(&env),
        });

        let mut ready_count = 0;
        let mut pending = Vec::new(&env);

        for p in lobby.participants.iter() {
            if p.is_ready {
                ready_count += 1;
            } else {
                pending.push_back(p.address);
            }
        }

        let total = lobby.participants.len();
        ReadyCheckSummary {
            total_players: total,
            ready_players: ready_count,
            is_everyone_ready: total > 0 && ready_count == total,
            pending_players: pending,
        }
    }

    /// Return the seat availability for a specific lobby.
    pub fn seat_availability(env: Env, lobby_id: u64) -> SeatAvailability {
        let lobby = storage::get_lobby(&env, lobby_id).unwrap_or(LobbyData {
            max_seats: 0,
            participants: Vec::new(&env),
        });

        let occupied = lobby.participants.len();
        let remaining = lobby.max_seats.saturating_sub(occupied);

        SeatAvailability {
            total_seats: lobby.max_seats,
            occupied_seats: occupied,
            remaining_seats: remaining,
            is_full: occupied >= lobby.max_seats && lobby.max_seats > 0,
        }
    }

    /// Create a new lobby. Admin only.
    pub fn create_lobby(env: Env, admin: Address, lobby_id: u64, max_seats: u32) {
        admin.require_auth();
        let stored_admin = storage::get_admin(&env).expect("Not initialized");
        assert!(admin == stored_admin, "Unauthorized");

        if storage::get_lobby(&env, lobby_id).is_some() {
            panic!("Lobby already exists");
        }

        storage::set_lobby(
            &env,
            lobby_id,
            &LobbyData {
                max_seats,
                participants: Vec::new(&env),
            },
        );
    }

    /// Join a lobby. Player must auth.
    pub fn join_lobby(env: Env, lobby_id: u64, player: Address) {
        player.require_auth();
        let mut lobby = storage::get_lobby(&env, lobby_id).expect("Lobby not found");

        if lobby.participants.len() >= lobby.max_seats {
            panic!("Lobby is full");
        }

        for p in lobby.participants.iter() {
            if p.address == player {
                panic!("Player already in lobby");
            }
        }

        lobby.participants.push_back(Participant {
            address: player,
            is_ready: false,
        });

        storage::set_lobby(&env, lobby_id, &lobby);
    }

    /// Set readiness state for a player in a lobby. Player must auth.
    pub fn set_ready(env: Env, lobby_id: u64, player: Address, ready: bool) {
        player.require_auth();
        let mut lobby = storage::get_lobby(&env, lobby_id).expect("Lobby not found");

        let mut found = false;
        let mut new_participants = Vec::new(&env);

        for p in lobby.participants.iter() {
            if p.address == player {
                new_participants.push_back(Participant {
                    address: p.address,
                    is_ready: ready,
                });
                found = true;
            } else {
                new_participants.push_back(p);
            }
        }

        if !found {
            panic!("Player not in lobby");
        }

        lobby.participants = new_participants;
        storage::set_lobby(&env, lobby_id, &lobby);
    }

    /// Set global paused state. Admin only.
    pub fn set_paused(env: Env, admin: Address, paused: bool) {
        admin.require_auth();
        let stored_admin = storage::get_admin(&env).expect("Not initialized");
        assert!(admin == stored_admin, "Unauthorized");
        storage::set_paused(&env, paused);
    }

    /// Return a snapshot of the lobby configuration.
    pub fn lobby_config_snapshot(env: Env, lobby_id: u64) -> LobbyConfigSnapshot {
        let paused = storage::get_paused(&env);
        match storage::get_lobby(&env, lobby_id) {
            Some(lobby) => LobbyConfigSnapshot {
                lobby_id,
                exists: true,
                max_seats: lobby.max_seats,
                participant_count: lobby.participants.len(),
                paused,
            },
            None => LobbyConfigSnapshot {
                lobby_id,
                exists: false,
                max_seats: 0,
                participant_count: 0,
                paused,
            },
        }
    }

    /// Set start grace period for a lobby. Admin only.
    pub fn set_start_grace(env: Env, admin: Address, lobby_id: u64, grace_blocks: u32) {
        admin.require_auth();
        let stored_admin = storage::get_admin(&env).expect("Not initialized");
        assert!(admin == stored_admin, "Unauthorized");
        storage::set_start_grace_blocks(&env, lobby_id, grace_blocks);
    }

    /// Return the start grace configuration for a lobby.
    pub fn start_grace_config(env: Env, lobby_id: u64) -> StartGraceConfig {
        match storage::get_start_grace_blocks(&env, lobby_id) {
            Some(blocks) => StartGraceConfig {
                grace_blocks: blocks,
                configured: true,
            },
            None => StartGraceConfig {
                grace_blocks: 0,
                configured: false,
            },
        }
    }
}
