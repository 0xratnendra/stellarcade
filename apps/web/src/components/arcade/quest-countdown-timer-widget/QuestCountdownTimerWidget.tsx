'use client';

import React, { useEffect, useRef, useState } from 'react';
import { QuestCountdownTimerWidgetProps, RemainingTime } from './types';
import './QuestCountdownTimerWidget.css';

const URGENT_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

/** Compute remaining time from the wall clock (`now`) to `target`,
 * clamped at zero. Exported for direct unit testing independent of
 * rendering and independent of real time (both `now` and `target` are
 * plain inputs).
 *
 * Deliberately recomputed from absolute timestamps on every call rather
 * than decrementing a stored counter each tick: decrementing drifts
 * against wall-clock time whenever a tick is delayed (e.g. a busy main
 * thread, a backgrounded tab throttling timers), while recomputing from
 * `Date.now()` vs. the fixed target is always exactly correct regardless
 * of how late or early a given tick actually fires.
 */
export function computeRemainingTime(now: number, target: number): RemainingTime {
  const totalMs = Math.max(0, target - now);
  const totalSeconds = Math.floor(totalMs / 1000);
  return {
    totalMs,
    hours: Math.floor(totalSeconds / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
    expired: totalMs <= 0,
  };
}

/** Format a `RemainingTime` as zero-padded `HH:MM:SS`. Exported for direct
 * unit testing. */
export function formatRemainingTime(remaining: RemainingTime): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(remaining.hours)}:${pad(remaining.minutes)}:${pad(remaining.seconds)}`;
}

function resolveTargetMs(targetResetTimestamp: string | number): number {
  return typeof targetResetTimestamp === 'number' ? targetResetTimestamp : new Date(targetResetTimestamp).getTime();
}

export function QuestCountdownTimerWidget({
  targetResetTimestamp,
  onExpire,
  label,
  className,
}: QuestCountdownTimerWidgetProps) {
  const targetMs = resolveTargetMs(targetResetTimestamp);
  const [remaining, setRemaining] = useState<RemainingTime>(() => computeRemainingTime(Date.now(), targetMs));
  const hasFiredExpireRef = useRef(false);

  useEffect(() => {
    hasFiredExpireRef.current = false;

    function tick() {
      const next = computeRemainingTime(Date.now(), targetMs);
      setRemaining(next);
      if (next.expired && !hasFiredExpireRef.current) {
        hasFiredExpireRef.current = true;
        onExpire?.();
      }
    }

    tick();
    const intervalId = window.setInterval(tick, 1000);
    return () => window.clearInterval(intervalId);
  }, [targetMs, onExpire]);

  const isUrgent = !remaining.expired && remaining.totalMs < URGENT_THRESHOLD_MS;

  return (
    <div
      className={`quest-countdown-widget${isUrgent ? ' quest-countdown-widget--urgent' : ''}${
        className ? ` ${className}` : ''
      }`}
      data-testid="quest-countdown-widget"
    >
      {label && <p className="quest-countdown-label">{label}</p>}
      {remaining.expired ? (
        <p className="quest-countdown-expired" data-testid="quest-countdown-expired">
          Refreshing quests&hellip;
        </p>
      ) : (
        <p className="quest-countdown-clock" data-testid="quest-countdown-clock">
          {formatRemainingTime(remaining)}
        </p>
      )}
    </div>
  );
}
