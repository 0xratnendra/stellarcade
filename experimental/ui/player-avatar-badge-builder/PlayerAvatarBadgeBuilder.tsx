import React, { useState } from "react";
import { PlayerAvatarBadgeBuilderProps, AvatarConfig, BadgePin } from "./types";
import "./PlayerAvatarBadgeBuilder.css";

const DEFAULT_BADGES: BadgePin[] = [
  { id: "badge_1", title: "First Win", iconEmoji: "🥇" },
  { id: "badge_2", title: "Streak Master", iconEmoji: "🔥" },
  { id: "badge_3", title: "High Roller", iconEmoji: "💎" },
];

export const PlayerAvatarBadgeBuilder: React.FC<PlayerAvatarBadgeBuilderProps> = ({
  avatarUrl,
  unlockedFrames,
  availableBadges = DEFAULT_BADGES,
  selectedFrameId,
  initialBadgeIds = [],
  onSave,
  className = "",
}) => {
  const [currentFrameId, setCurrentFrameId] = useState<string>(
    selectedFrameId || (unlockedFrames.find((f) => f.isUnlocked)?.id ?? "")
  );
  const [selectedBadges, setSelectedBadges] = useState<string[]>(
    initialBadgeIds.slice(0, 3)
  );

  const activeFrame = unlockedFrames.find((f) => f.id === currentFrameId);

  const handleToggleBadge = (badgeId: string) => {
    if (selectedBadges.includes(badgeId)) {
      setSelectedBadges((prev) => prev.filter((id) => id !== badgeId));
    } else {
      if (selectedBadges.length < 3) {
        setSelectedBadges((prev) => [...prev, badgeId]);
      }
    }
  };

  const handleSave = () => {
    onSave({
      frameId: currentFrameId,
      selectedBadgeIds: selectedBadges,
    });
  };

  const hasUnlockedFrames = unlockedFrames.some((f) => f.isUnlocked);

  return (
    <div className={`avatar-builder-container ${className}`}>
      <h3>Avatar Badge Customizer</h3>

      {/* Live Preview Canvas */}
      <div className="avatar-preview-canvas" data-testid="avatar-preview">
        <div
          className="avatar-image-ring"
          style={{
            borderColor: activeFrame?.borderColor || "#4b5563",
            boxShadow: activeFrame?.glowColor
              ? `0 0 12px ${activeFrame.glowColor}`
              : "none",
          }}
        >
          <img src={avatarUrl} alt="Player Avatar" className="avatar-image" />
        </div>

        <div className="avatar-badges-overlay">
          {selectedBadges.map((badgeId) => {
            const badge = availableBadges.find((b) => b.id === badgeId);
            return badge ? (
              <span key={badge.id} className="badge-pin-icon" title={badge.title}>
                {badge.iconEmoji}
              </span>
            ) : null;
          })}
        </div>
      </div>

      {/* Frame Selection */}
      {!hasUnlockedFrames ? (
        <div className="empty-frames-state">No unlocked frames available. Play games to earn frames!</div>
      ) : (
        <div className="frame-selector-carousel" role="radiogroup" aria-label="Avatar Frames">
          {unlockedFrames.map((frame) => {
            const isSelected = frame.id === currentFrameId;
            return (
              <button
                key={frame.id}
                type="button"
                className={`frame-card-item ${isSelected ? "selected" : ""}`}
                disabled={!frame.isUnlocked}
                onClick={() => setCurrentFrameId(frame.id)}
                aria-checked={isSelected}
                role="radio"
              >
                <span>{frame.name}</span>
                <span style={{ fontSize: "0.65rem", color: frame.isUnlocked ? "#10b981" : "#ef4444" }}>
                  {frame.isUnlocked ? "Unlocked" : "Locked"}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Badge Pins Selector */}
      <div style={{ display: "flex", gap: "0.5rem" }}>
        {availableBadges.map((badge) => {
          const isSelected = selectedBadges.includes(badge.id);
          return (
            <button
              key={badge.id}
              type="button"
              className={`frame-card-item ${isSelected ? "selected" : ""}`}
              onClick={() => handleToggleBadge(badge.id)}
            >
              <span>{badge.iconEmoji}</span>
            </button>
          );
        })}
      </div>

      <button type="button" className="save-customization-btn" onClick={handleSave}>
        Save Customization
      </button>
    </div>
  );
};
