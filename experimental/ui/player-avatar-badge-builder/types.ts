export interface AvatarFrame {
  id: string;
  name: string;
  borderColor: string;
  glowColor?: string;
  isUnlocked: boolean;
}

export interface BadgePin {
  id: string;
  title: string;
  iconEmoji: string;
}

export interface AvatarConfig {
  frameId: string;
  selectedBadgeIds: string[];
}

export interface PlayerAvatarBadgeBuilderProps {
  avatarUrl: string;
  unlockedFrames: AvatarFrame[];
  availableBadges?: BadgePin[];
  selectedFrameId?: string;
  initialBadgeIds?: string[];
  onSave: (config: AvatarConfig) => void;
  className?: string;
}
