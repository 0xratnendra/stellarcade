import React, { useState } from 'react';
import type { MiniLeaderboardTickerProps } from './types';

const styles = `
.mlt{overflow:hidden;background:#111827;color:#fff;border:1px solid #374151;border-radius:999px;padding:8px 0;font:14px system-ui}.mlt__track{display:flex;width:max-content;animation:mlt-scroll var(--mlt-duration,30s) linear infinite}.mlt:hover .mlt__track,.mlt:focus-within .mlt__track{animation-play-state:paused}.mlt__group{display:flex;flex-shrink:0}.mlt__item{display:flex;align-items:center;gap:8px;padding:0 18px;border-right:1px solid #374151;background:transparent;color:inherit;border-top:0;border-bottom:0;border-left:0;cursor:pointer;white-space:nowrap}.mlt__item:hover{color:#67e8f9}.mlt__avatar{width:24px;height:24px;border-radius:50%;object-fit:cover;background:#374151}.mlt__payout{color:#86efac;font-weight:700}.mlt__multiplier{color:#fbbf24;font-weight:700}@keyframes mlt-scroll{to{transform:translateX(-50%)}}@media(prefers-reduced-motion:reduce){.mlt__track{animation:none!important}}
`;

export const MiniLeaderboardTicker: React.FC<MiniLeaderboardTickerProps> = ({ wins, speed = 80, onSelectWin }) => {
  const [focused, setFocused] = useState<string | null>(null);
  const group = (copy: boolean) => wins.map((item) => (
    <button className="mlt__item" type="button" key={`${copy ? 'copy-' : ''}${item.id}`} onClick={() => onSelectWin?.(item)} onFocus={() => setFocused(item.id)} onBlur={() => setFocused(null)} aria-label={`View ${item.playerAddress} win in ${item.game}`}>
      {item.avatarUrl ? <img className="mlt__avatar" src={item.avatarUrl} alt="" /> : <span className="mlt__avatar" aria-hidden="true">👤</span>}
      <span>{item.playerAddress}</span><span>{item.gameIcon ?? '🎮'} {item.game}</span><span className="mlt__payout">{item.payout}</span><span className="mlt__multiplier">{item.multiplier}x</span>
    </button>
  ));
  if (!wins.length) return <div className="mlt" role="status">No recent wins</div>;
  return <><style>{styles}</style><div className="mlt" data-focused={focused ?? undefined} role="region" aria-label="Recent wins"><div className="mlt__track" style={{ '--mlt-duration': `${Math.max(10, (wins.length * 180) / speed)}s` } as React.CSSProperties}><div className="mlt__group">{group(false)}</div><div className="mlt__group" aria-hidden="true">{group(true)}</div></div></div></>;
};
export default MiniLeaderboardTicker;
