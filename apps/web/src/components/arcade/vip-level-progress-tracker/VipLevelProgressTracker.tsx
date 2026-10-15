'use client';

import React from 'react';
import { VipLevelProgressTrackerProps } from './types';
import './VipLevelProgressTracker.css';

/** Compute the progress percentage toward the next tier, clamped to
 * [0, 100]. Exported for direct unit testing independent of rendering. */
export function computeProgressPercent(currentPoints: number, nextTierPoints: number): number {
  if (nextTierPoints <= 0) return 0;
  const raw = (currentPoints / nextTierPoints) * 100;
  return Math.min(100, Math.max(0, raw));
}

/** True when there is no further tier to progress toward. */
export function isMaxTier(currentPoints: number, nextTierPoints: number): boolean {
  return nextTierPoints <= currentPoints;
}

const TIER_CLASS: Record<string, string> = {
  Bronze: 'vip-tier-badge--bronze',
  Silver: 'vip-tier-badge--silver',
  Gold: 'vip-tier-badge--gold',
  Platinum: 'vip-tier-badge--platinum',
};

export function VipLevelProgressTracker({
  currentTier,
  currentPoints,
  nextTierPoints,
  perks,
  className,
}: VipLevelProgressTrackerProps) {
  const atMaxTier = isMaxTier(currentPoints, nextTierPoints);
  const progressPercent = computeProgressPercent(currentPoints, nextTierPoints);

  return (
    <div className={`vip-progress-card${className ? ` ${className}` : ''}`} data-testid="vip-progress-card">
      <div className={`vip-tier-badge ${TIER_CLASS[currentTier] ?? ''}`} data-testid="vip-tier-badge">
        {currentTier}
      </div>

      {atMaxTier ? (
        <div className="vip-max-tier-banner" data-testid="vip-max-tier-banner">
          Maximum Tier Reached
        </div>
      ) : (
        <div className="vip-progress-section">
          <div
            className="vip-progress-track"
            role="progressbar"
            aria-valuenow={Math.round(progressPercent)}
            aria-valuemin={0}
            aria-valuemax={100}
            data-testid="vip-progress-bar"
          >
            <div className="vip-progress-fill" style={{ width: `${progressPercent}%` }} />
          </div>
          <p className="vip-progress-label">
            {currentPoints.toLocaleString()} / {nextTierPoints.toLocaleString()} points to next tier
          </p>
        </div>
      )}

      <ul className="vip-perks-list">
        {perks.map((perk) => (
          <li
            key={perk.id}
            className={`vip-perk-row${perk.unlocked ? ' vip-perk-row--unlocked' : ''}`}
            data-testid={`vip-perk-${perk.id}`}
          >
            <span className="vip-perk-check" aria-hidden="true">
              {perk.unlocked ? '✓' : '•'}
            </span>
            <span>{perk.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
