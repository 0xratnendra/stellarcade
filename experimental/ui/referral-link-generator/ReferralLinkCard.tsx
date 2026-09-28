import React, { useEffect, useMemo, useState } from 'react';
import type { ReferralLinkCardProps } from './types';

const styles = `.rlc{max-width:420px;padding:20px;border:1px solid #374151;border-radius:16px;background:#111827;color:#f9fafb;font:14px system-ui}.rlc h2{margin:0 0 14px}.rlc__qr{display:grid;place-items:center;width:150px;height:150px;margin:12px auto;border:8px solid white;background:repeating-conic-gradient(#111 0 25%,#fff 0 50%) 0/18px 18px;color:#111}.rlc__link{display:flex;gap:8px}.rlc input{min-width:0;flex:1;padding:8px;border-radius:6px;border:1px solid #4b5563;background:#1f2937;color:inherit}.rlc button,.rlc a{padding:8px 10px;border-radius:6px;border:0;background:#2563eb;color:white;text-decoration:none;cursor:pointer}.rlc__stats{display:flex;justify-content:space-between;margin-top:16px;color:#d1d5db}.rlc__shares{display:flex;gap:8px;margin-top:12px}`;

export const ReferralLinkCard: React.FC<ReferralLinkCardProps> = ({ referralCode, baseUrl = '', invitedCount = 0, rewardsEarned = '0' }) => {
  const [copied, setCopied] = useState(false);
  const link = useMemo(() => `${baseUrl.replace(/\\/$/, '')}/ref/${encodeURIComponent(referralCode)}`, [baseUrl, referralCode]);
  useEffect(() => { if (!copied) return; const timer = window.setTimeout(() => setCopied(false), 2000); return () => window.clearTimeout(timer); }, [copied]);
  const copy = async () => { try { if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(link); else { const input = document.createElement('textarea'); input.value = link; document.body.appendChild(input); input.select(); document.execCommand('copy'); input.remove(); } setCopied(true); } catch { setCopied(false); } };
  const share = encodeURIComponent(link);
  return <><style>{styles}</style><section className="rlc" aria-label="Referral link generator"><h2>Invite friends</h2><div className="rlc__qr" data-qr-value={link} role="img" aria-label={`QR code for ${link}`}>QR</div><div className="rlc__link"><input readOnly value={link} aria-label="Referral link" /><button type="button" onClick={copy}>{copied ? '✓ Copied!' : 'Copy'}</button></div><div className="rlc__stats"><span>Invited <strong>{invitedCount}</strong></span><span>Rewards <strong>{rewardsEarned}</strong></span></div><div className="rlc__shares"><a href={`https://twitter.com/intent/tweet?url=${share}`} target="_blank" rel="noreferrer">X / Twitter</a><a href={`https://t.me/share/url?url=${share}`} target="_blank" rel="noreferrer">Telegram</a><a href={`https://discord.com/channels/@me?url=${share}`} target="_blank" rel="noreferrer">Discord</a></div></section></>;
};
export default ReferralLinkCard;
