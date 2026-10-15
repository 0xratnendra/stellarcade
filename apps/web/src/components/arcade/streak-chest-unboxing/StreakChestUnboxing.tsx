'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  AnimationPhase,
  LootTier,
  StreakChestUnboxingProps,
} from './types';
import './StreakChestUnboxing.css';

export function normalizeLootTier(tier: string): LootTier {
  const normalized = tier.toLowerCase();
  if (normalized === 'rare') return 'Rare';
  if (normalized === 'epic') return 'Epic';
  if (normalized === 'legendary') return 'Legendary';
  return 'Common';
}

export function nextPhaseAfterUnlock(current: AnimationPhase): AnimationPhase {
  if (current === 'shaking') return 'opened';
  if (current === 'opened') return 'revealed';
  return current;
}

export function StreakChestUnboxing({
  isOpen,
  chestTier,
  reward,
  onClaim,
  onClose,
}: StreakChestUnboxingProps) {
  const [phase, setPhase] = useState<AnimationPhase>('idle');

  useEffect(() => {
    if (!isOpen) {
      setPhase('idle');
      return;
    }
    setPhase('idle');
  }, [isOpen, reward?.id]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const startUnlock = useCallback(() => {
    if (!reward) return;
    setPhase('shaking');
    window.setTimeout(() => {
      setPhase('opened');
      window.setTimeout(() => setPhase('revealed'), 350);
    }, 600);
  }, [reward]);

  if (!isOpen) {
    return null;
  }

  const lootTier = reward ? normalizeLootTier(reward.tier) : 'Common';
  const crateClass = [
    'streak-chest-crate',
    phase === 'shaking' ? 'streak-chest-crate--shaking' : '',
    phase === 'opened' || phase === 'revealed' ? 'streak-chest-crate--opened' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className="streak-chest-backdrop"
      data-testid="streak-chest-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Daily quest streak chest unboxing"
        data-testid="streak-chest-dialog"
        data-phase={phase}
        className={`streak-chest-dialog streak-chest-dialog--${chestTier}`}
      >
        <h2>Daily Streak Chest</h2>
        <div className={crateClass} data-testid="streak-chest-crate" />

        {!reward && (
          <div className="streak-chest-empty" data-testid="streak-chest-empty">
            Reward metadata is unavailable. Try again later.
          </div>
        )}

        {reward && phase === 'revealed' && (
          <div
            className={`streak-chest-loot streak-chest-loot--${lootTier}`}
            data-testid="streak-chest-loot"
          >
            <div data-testid="streak-chest-loot-tier">{lootTier}</div>
            <strong data-testid="streak-chest-loot-name">{reward.name}</strong>
            <div data-testid="streak-chest-loot-amount">
              {reward.amount} {reward.symbol}
            </div>
          </div>
        )}

        <div className="streak-chest-actions">
          {reward && phase === 'idle' && (
            <button
              type="button"
              className="streak-chest-btn streak-chest-btn--primary"
              data-testid="streak-chest-unlock"
              onClick={startUnlock}
            >
              Unlock Chest
            </button>
          )}
          {reward && phase === 'revealed' && (
            <button
              type="button"
              className="streak-chest-btn streak-chest-btn--primary"
              data-testid="streak-chest-claim"
              onClick={() => onClaim(reward.id)}
            >
              Claim to Inventory
            </button>
          )}
          <button
            type="button"
            className="streak-chest-btn streak-chest-btn--ghost"
            data-testid="streak-chest-dismiss"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
