"use client";

import GlobalStateStore from "./global-state-store";
import { ApiClient } from "./typed-api-sdk";
import type { UserProfile } from "../types/api-client";

/**
 * The app-wide profile store.
 *
 * This used to be declared inside ProfileSettings.tsx, which meant the shell
 * and the sidebar had to import a *page component* just to read who the
 * player is. Owning it here lets every surface share one instance without
 * that dependency, and is what makes a username change show up in the
 * sidebar immediately instead of only after a reload.
 */
export const profileStore = new GlobalStateStore();

/** Usernames are the player's public identity — keep the rules in one place. */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]+$/;

/** Returns a human-readable problem with the name, or null when it's fine. */
export function validateUsername(raw: string): string | null {
  const name = raw.trim();
  if (!name) return "Choose a username.";
  if (name.length < USERNAME_MIN || name.length > USERNAME_MAX) {
    return `Username must be ${USERNAME_MIN}-${USERNAME_MAX} characters.`;
  }
  if (!USERNAME_PATTERN.test(name)) {
    return "Username can only use letters, numbers, and . _ -";
  }
  return null;
}

export function getStoreToken(): string | null {
  return profileStore.getState().auth.token ?? null;
}

/**
 * API client carrying the session token.
 *
 * AppShell previously built a bare `new ApiClient({ baseUrl })` with no
 * session store, so its profile sync was unauthenticated and always failed —
 * which is why the sidebar only ever picked up a username after the user
 * visited /profile (the one place that did pass a token).
 *
 * `baseUrl` must be omitted here, not set to `window.location.origin` — the
 * backend lives on its own origin (`NEXT_PUBLIC_API_BASE_URL`), and
 * `ApiClient`'s constructor only falls back to that env var when no
 * `baseUrl` is passed at all (an explicit `baseUrl`, even the wrong one,
 * always wins). Passing the frontend's own origin here silently pointed
 * every profile/balance/auth request at this Next.js app instead of the
 * API, so they all 404'd against Next's own catch-all — every caller of
 * this client (fetchProfile, createProfile, useXlmBalance, ...) was already
 * built to distinguish a real 404 (no profile yet) from other failures, so
 * that 404 was silently read as "wallet has no profile," re-triggering
 * onboarding and clearing profile state on every load. Match the working
 * pattern other clients use (see `GameLobby.tsx`'s `new ApiClient()`).
 */
export function createProfileApiClient(): ApiClient {
  return new ApiClient({
    sessionStore: { getToken: () => getStoreToken() },
  });
}

export type ProfileLookup =
  | { status: "found"; profile: UserProfile }
  /** No profile for this address — the wallet needs first-run onboarding. */
  | { status: "not-found" }
  /** Request failed for some other reason; caller should not onboard. */
  | { status: "error"; message: string };

/**
 * Read the profile belonging to one address and publish it to the store.
 *
 * "Not found" is a first-class outcome, not an error: a wallet with no
 * profile is simply new. Callers must never substitute a default identity
 * for it.
 */
export async function fetchProfile(address: string): Promise<ProfileLookup> {
  const client = createProfileApiClient();
  const result = await client.getProfile(address);

  if (result.success && result.data) {
    profileStore.dispatch({
      type: "PROFILE_SET",
      payload: { profile: result.data },
    });
    return { status: "found", profile: result.data };
  }

  if (!result.success && result.error.status === 404) {
    profileStore.dispatch({ type: "PROFILE_CLEAR" });
    return { status: "not-found" };
  }

  return {
    status: "error",
    message: result.success
      ? "Unexpected empty profile response."
      : result.error.message,
  };
}

/**
 * Complete first-run setup for a wallet.
 *
 * Usually a create. But a wallet can legitimately already have a profile row
 * and still need onboarding — anyone who registered before the age gate has a
 * username but no `ageConfirmedAt`. Creating would 409 with PROFILE_EXISTS
 * and trap them in the dialog forever, so that case falls through to an
 * update, which records the confirmation on the existing row.
 */
export async function createProfile(input: {
  address: string;
  username: string;
  ageConfirmed: boolean;
}): Promise<
  { ok: true; profile: UserProfile } | { ok: false; message: string }
> {
  const client = createProfileApiClient();
  const created = await client.createProfile(input);

  if (created.success && created.data) {
    profileStore.dispatch({
      type: "PROFILE_SET",
      payload: { profile: created.data },
    });
    return { ok: true, profile: created.data };
  }

  const isExistingProfile =
    !created.success && created.error.serverCode === "PROFILE_EXISTS";

  if (isExistingProfile) {
    const updated = await client.updateProfile({
      address: input.address,
      username: input.username.trim(),
      ageConfirmed: input.ageConfirmed,
    });

    if (updated.success && updated.data) {
      profileStore.dispatch({
        type: "PROFILE_SET",
        payload: { profile: updated.data },
      });
      return { ok: true, profile: updated.data };
    }

    return {
      ok: false,
      message: updated.success
        ? "Profile update returned no data."
        : updated.error.message,
    };
  }

  return {
    ok: false,
    message: created.success
      ? "Profile creation returned no data."
      : created.error.message,
  };
}

/** Rename an existing profile, publishing the result to the store. */
export async function saveUsername(
  address: string,
  username: string,
): Promise<
  { ok: true; profile: UserProfile } | { ok: false; message: string }
> {
  const client = createProfileApiClient();
  const result = await client.updateProfile({
    address,
    username: username.trim(),
  });

  if (result.success && result.data) {
    profileStore.dispatch({
      type: "PROFILE_SET",
      payload: { profile: result.data },
    });
    return { ok: true, profile: result.data };
  }

  return {
    ok: false,
    message: result.success
      ? "Profile update returned no data."
      : result.error.message,
  };
}

/** True when the wallet still owes us a username and/or an age confirmation. */
export function needsOnboarding(
  profile: UserProfile | null | undefined,
): boolean {
  if (!profile) return true;
  return !profile.username?.trim() || !profile.ageConfirmedAt;
}

/**
 * Completes wallet-signature login: fetch a one-time challenge, have the
 * wallet sign it, exchange the signature for a session JWT, then publish
 * both the token and the resulting profile to the store. This is the only
 * place `auth.token` ever gets set — every auth-required API call was
 * unreachable in production before this existed, since nothing ever issued
 * that token.
 *
 * Deliberately swallow-and-report rather than throw: callers use this as a
 * best-effort enhancement after a wallet connects, not a precondition for
 * the connection itself succeeding.
 */
export async function authenticateWallet(
  address: string,
  signMessage: (message: string) => Promise<string>,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const client = createProfileApiClient();

  const challengeRes = await client.createLoginChallenge({ address });
  if (!challengeRes.success) {
    return { ok: false, message: challengeRes.error.message };
  }

  let signature: string;
  try {
    signature = await signMessage(challengeRes.data.challenge);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to sign login challenge";
    return { ok: false, message };
  }

  const loginRes = await client.login({ address, signature });
  if (!loginRes.success) {
    return { ok: false, message: loginRes.error.message };
  }

  profileStore.dispatch({
    type: "AUTH_SET",
    payload: {
      userId: loginRes.data.profile.address,
      token: loginRes.data.token,
    },
  });
  profileStore.dispatch({
    type: "PROFILE_SET",
    payload: { profile: loginRes.data.profile },
  });

  return { ok: true };
}
