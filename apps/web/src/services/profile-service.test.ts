import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import {
  authenticateWallet,
  getStoreToken,
  needsOnboarding,
  profileStore,
  validateUsername,
} from "./profile-service";
import type { UserProfile } from "../types/api-client";

function mockFetchSequence(
  responses: Array<{ status: number; body: unknown }>,
): void {
  const mock = vi.fn();
  for (const r of responses) {
    mock.mockResolvedValueOnce({
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body,
    } as Response);
  }
  global.fetch = mock;
}

const complete: UserProfile = {
  address: "GABC123",
  username: "nova_runner",
  createdAt: "2026-01-01T00:00:00.000Z",
  ageConfirmedAt: "2026-01-01T00:00:00.000Z",
};

describe("validateUsername", () => {
  it("accepts a normal name", () => {
    expect(validateUsername("nova_runner")).toBeNull();
    expect(validateUsername("a.b-c_1")).toBeNull();
  });

  it("rejects empty and whitespace-only names", () => {
    expect(validateUsername("")).toMatch(/choose a username/i);
    expect(validateUsername("   ")).toMatch(/choose a username/i);
  });

  it("enforces length bounds", () => {
    expect(validateUsername("ab")).toMatch(/3-20 characters/);
    expect(validateUsername("x".repeat(21))).toMatch(/3-20 characters/);
  });

  it("rejects characters outside the allowed set", () => {
    expect(validateUsername("nova runner")).toMatch(/letters, numbers/i);
    expect(validateUsername("nova@runner")).toMatch(/letters, numbers/i);
    expect(validateUsername("<script>")).toMatch(/letters, numbers/i);
  });
});

describe("needsOnboarding", () => {
  it("is false only for a profile with both a username and an age confirmation", () => {
    expect(needsOnboarding(complete)).toBe(false);
  });

  it("is true when there is no profile at all", () => {
    expect(needsOnboarding(null)).toBe(true);
    expect(needsOnboarding(undefined)).toBe(true);
  });

  it("is true when the username is missing or blank", () => {
    expect(needsOnboarding({ ...complete, username: undefined })).toBe(true);
    expect(needsOnboarding({ ...complete, username: "   " })).toBe(true);
  });

  /*
   * A profile that predates the age gate has no ageConfirmedAt. Treating a
   * missing confirmation as an implicit yes would let those accounts through
   * without ever being asked, so it must count as un-onboarded.
   */
  it("is true when the age confirmation is missing", () => {
    expect(needsOnboarding({ ...complete, ageConfirmedAt: undefined })).toBe(
      true,
    );
  });
});

describe("authenticateWallet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    profileStore.dispatch({ type: "RESET_ALL" });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("completes challenge -> sign -> login and publishes token + profile to the store", async () => {
    mockFetchSequence([
      {
        status: 200,
        body: { challenge: "Sign in to StellarCade\n\nNonce: abc" },
      },
      {
        status: 200,
        body: {
          token: "jwt-xyz",
          profile: { address: "GABC123", createdAt: "2026-01-01" },
        },
      },
    ]);
    const signMessage = vi.fn().mockResolvedValue("c2ln");

    const result = await authenticateWallet("GABC123", signMessage);

    expect(result).toEqual({ ok: true });
    expect(signMessage).toHaveBeenCalledWith(
      "Sign in to StellarCade\n\nNonce: abc",
    );
    expect(profileStore.getState().auth).toEqual(
      expect.objectContaining({
        isAuthenticated: true,
        userId: "GABC123",
        token: "jwt-xyz",
      }),
    );
    expect(profileStore.getState().profile?.address).toBe("GABC123");
  });

  it("reports failure without throwing when the wallet rejects the signature", async () => {
    mockFetchSequence([
      {
        status: 200,
        body: { challenge: "Sign in to StellarCade\n\nNonce: abc" },
      },
    ]);
    const signMessage = vi
      .fn()
      .mockRejectedValue(new Error("User declined access"));

    const result = await authenticateWallet("GABC123", signMessage);

    expect(result).toEqual({ ok: false, message: "User declined access" });
    expect(profileStore.getState().auth.isAuthenticated).toBe(false);
  });

  it("reports failure when the challenge request itself fails, without calling signMessage", async () => {
    mockFetchSequence([{ status: 500, body: { message: "boom" } }]);
    const signMessage = vi.fn();

    const result = await authenticateWallet("GABC123", signMessage);

    expect(result.ok).toBe(false);
    expect(signMessage).not.toHaveBeenCalled();
  });

  it("reports failure when the backend rejects the signature, without touching the store", async () => {
    mockFetchSequence([
      {
        status: 200,
        body: { challenge: "Sign in to StellarCade\n\nNonce: abc" },
      },
      {
        status: 401,
        body: {
          error: {
            message: "Signature does not verify",
            code: "INVALID_SIGNATURE",
          },
        },
      },
    ]);
    const signMessage = vi.fn().mockResolvedValue("bad-sig");

    const result = await authenticateWallet("GABC123", signMessage);

    expect(result.ok).toBe(false);
    expect(profileStore.getState().auth.isAuthenticated).toBe(false);
  });
});

describe("getStoreToken", () => {
  beforeEach(() => {
    profileStore.dispatch({ type: "RESET_ALL" });
  });

  it("returns null when no token is in the store, even in development", () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      (process.env as Record<string, string | undefined>).NODE_ENV =
        "development";
      expect(getStoreToken()).toBeNull();
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV =
        originalEnv;
    }
  });

  it("returns the token when one exists in the store", () => {
    profileStore.dispatch({
      type: "AUTH_SET",
      payload: { userId: "GABC123", token: "valid-session-jwt" },
    });
    expect(getStoreToken()).toBe("valid-session-jwt");
  });
});
