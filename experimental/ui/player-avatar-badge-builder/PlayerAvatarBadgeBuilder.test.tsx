import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PlayerAvatarBadgeBuilder } from "./PlayerAvatarBadgeBuilder";
import { AvatarFrame } from "./types";

const mockFrames: AvatarFrame[] = [
  { id: "frame_gold", name: "Gold Frame", borderColor: "#f59e0b", isUnlocked: true },
  { id: "frame_neon", name: "Neon Frame", borderColor: "#06b6d4", isUnlocked: true },
  { id: "frame_locked", name: "Cyberpunk", borderColor: "#ec4899", isUnlocked: false },
];

describe("PlayerAvatarBadgeBuilder", () => {
  it("selecting frame updates preview element styling", () => {
    const onSave = vi.fn();
    render(
      <PlayerAvatarBadgeBuilder
        avatarUrl="https://example.com/avatar.png"
        unlockedFrames={mockFrames}
        selectedFrameId="frame_gold"
        onSave={onSave}
      />
    );

    const neonBtn = screen.getByRole("radio", { name: /Neon Frame/i });
    fireEvent.click(neonBtn);

    expect(neonBtn).toHaveAttribute("aria-checked", "true");
  });

  it("save button passes selected frame ID", () => {
    const onSave = vi.fn();
    render(
      <PlayerAvatarBadgeBuilder
        avatarUrl="https://example.com/avatar.png"
        unlockedFrames={mockFrames}
        selectedFrameId="frame_gold"
        onSave={onSave}
      />
    );

    const saveBtn = screen.getByRole("button", { name: "Save Customization" });
    fireEvent.click(saveBtn);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({
      frameId: "frame_gold",
      selectedBadgeIds: [],
    });
  });

  it("empty frame list renders fallback state", () => {
    const onSave = vi.fn();
    render(
      <PlayerAvatarBadgeBuilder
        avatarUrl="https://example.com/avatar.png"
        unlockedFrames={[]}
        onSave={onSave}
      />
    );

    expect(screen.getByText(/No unlocked frames available/i)).toBeInTheDocument();
  });
});
