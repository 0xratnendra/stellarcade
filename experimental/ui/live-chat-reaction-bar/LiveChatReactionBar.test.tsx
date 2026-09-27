import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { LiveChatReactionBar } from "./LiveChatReactionBar";

describe("LiveChatReactionBar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls onSendReaction callback when clicking emoji button", () => {
    const onSendReaction = vi.fn();
    render(<LiveChatReactionBar onSendReaction={onSendReaction} />);

    const fireBtn = screen.getByRole("button", { name: "Send 🔥 reaction" });
    fireEvent.click(fireBtn);

    expect(onSendReaction).toHaveBeenCalledTimes(1);
    expect(onSendReaction).toHaveBeenCalledWith("🔥");
  });

  it("locks reaction button temporarily during cooldown", () => {
    const onSendReaction = vi.fn();
    render(<LiveChatReactionBar onSendReaction={onSendReaction} cooldownMs={1000} />);

    const fireBtn = screen.getByRole("button", { name: "Send 🔥 reaction" });
    fireEvent.click(fireBtn);

    expect(onSendReaction).toHaveBeenCalledTimes(1);
    expect(fireBtn).toBeDisabled();

    // Fast-forward time past cooldown
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(fireBtn).not.toBeDisabled();
  });

  it("disabled state prevents sending reactions", () => {
    const onSendReaction = vi.fn();
    render(<LiveChatReactionBar onSendReaction={onSendReaction} disabled={true} />);

    const fireBtn = screen.getByRole("button", { name: "Send 🔥 reaction" });
    expect(fireBtn).toBeDisabled();

    fireEvent.click(fireBtn);
    expect(onSendReaction).not.toHaveBeenCalled();
  });

  it("renders spectator view state when isSpectatorOnly is true", () => {
    const onSendReaction = vi.fn();
    render(<LiveChatReactionBar onSendReaction={onSendReaction} isSpectatorOnly={true} />);

    expect(screen.getByText(/Spectator View/i)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
