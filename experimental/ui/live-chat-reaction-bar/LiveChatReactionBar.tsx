import React, { useState, useEffect, useRef } from "react";
import { LiveChatReactionBarProps, FloatingBurst } from "./types";
import "./LiveChatReactionBar.css";

const DEFAULT_EMOJIS = ["🔥", "🚀", "💀", "💎", "🎲", "🏆"];

export const LiveChatReactionBar: React.FC<LiveChatReactionBarProps> = ({
  onSendReaction,
  onPlaySoundCue,
  cooldownMs = 1500,
  disabled = false,
  isSpectatorOnly = false,
  className = "",
  presetEmojis = DEFAULT_EMOJIS,
}) => {
  const [cooldowns, setCooldowns] = useState<Record<string, boolean>>({});
  const [bursts, setBursts] = useState<FloatingBurst[]>([]);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const isGloballyDisabled = disabled || isSpectatorOnly;

  const triggerReaction = (emoji: string, index: number) => {
    if (isGloballyDisabled || cooldowns[emoji]) {
      if (onPlaySoundCue && cooldowns[emoji]) {
        onPlaySoundCue("cooldown_blocked");
      }
      return;
    }

    onSendReaction(emoji);
    if (onPlaySoundCue) {
      onPlaySoundCue("reaction_sent");
    }

    // Cooldown rate-limit
    setCooldowns((prev) => ({ ...prev, [emoji]: true }));
    setTimeout(() => {
      setCooldowns((prev) => ({ ...prev, [emoji]: false }));
    }, cooldownMs);

    // Burst animation
    const newBurst: FloatingBurst = {
      id: `${Date.now()}-${Math.random()}`,
      emoji,
      xOffset: (index - (presetEmojis.length - 1) / 2) * 30,
    };
    setBursts((prev) => [...prev, newBurst]);

    setTimeout(() => {
      setBursts((prev) => prev.filter((b) => b.id !== newBurst.id));
    }, 800);
  };

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (isGloballyDisabled) return;

    if (e.key === "ArrowRight") {
      e.preventDefault();
      const nextIndex = (index + 1) % presetEmojis.length;
      buttonRefs.current[nextIndex]?.focus();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      const prevIndex = (index - 1 + presetEmojis.length) % presetEmojis.length;
      buttonRefs.current[prevIndex]?.focus();
    }
  };

  return (
    <div
      className={`reaction-bar-container ${className}`}
      role="toolbar"
      aria-label="Live Match Reaction Bar"
    >
      <div className="reaction-burst-container">
        {bursts.map((burst) => (
          <span
            key={burst.id}
            className="reaction-burst-emoji"
            style={{ left: `calc(50% + ${burst.xOffset}px)` }}
          >
            {burst.emoji}
          </span>
        ))}
      </div>

      {isSpectatorOnly ? (
        <span className="spectator-badge">Spectator View (Reactions Disabled)</span>
      ) : (
        presetEmojis.map((emoji, index) => {
          const isCoolingDown = !!cooldowns[emoji];
          const isBtnDisabled = isGloballyDisabled || isCoolingDown;

          return (
            <button
              key={emoji}
              ref={(el) => (buttonRefs.current[index] = el)}
              type="button"
              className="reaction-bar-button"
              disabled={isBtnDisabled}
              aria-label={`Send ${emoji} reaction`}
              onClick={() => triggerReaction(emoji, index)}
              onKeyDown={(e) => handleKeyDown(e, index)}
            >
              {emoji}
            </button>
          );
        })
      )}
    </div>
  );
};
