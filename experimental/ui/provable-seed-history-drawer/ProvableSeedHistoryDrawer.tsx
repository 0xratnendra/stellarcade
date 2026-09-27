import React, { useEffect } from "react";
import { ProvableSeedHistoryDrawerProps, SeedHistoryEntry } from "./types";
import "./ProvableSeedHistoryDrawer.css";

export const ProvableSeedHistoryDrawer: React.FC<ProvableSeedHistoryDrawerProps> = ({
  isOpen,
  seeds,
  onRotateSeed,
  onClose,
  className = "",
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const activeSeed = seeds.find((s) => s.status === "active") || seeds[0];
  const historicSeeds = seeds.filter((s) => s !== activeSeed);

  const copyToClipboard = (text: string) => {
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text);
    }
  };

  const truncateHash = (hash: string) => {
    if (hash.length <= 16) return hash;
    return `${hash.slice(0, 8)}...${hash.slice(-8)}`;
  };

  return (
    <>
      <div
        className={`drawer-backdrop ${isOpen ? "open" : ""}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={`seed-drawer-panel ${isOpen ? "open" : ""} ${className}`}
        role="dialog"
        aria-label="Provable Seed History"
        aria-modal={isOpen}
      >
        <div className="drawer-header">
          <h3>Provable Seed History</h3>
          <button
            type="button"
            className="drawer-close-btn"
            onClick={onClose}
            aria-label="Close Drawer"
          >
            &times;
          </button>
        </div>

        <div className="drawer-content-body">
          {/* Active Seed Card */}
          {activeSeed && (
            <div className="active-seed-card">
              <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "#8b5cf6" }}>
                Active Seed Pair
              </span>
              <div className="hash-string-box">
                <span>Client: {truncateHash(activeSeed.clientSeed)}</span>
                <button
                  type="button"
                  className="copy-hash-btn"
                  onClick={() => copyToClipboard(activeSeed.clientSeed)}
                >
                  Copy
                </button>
              </div>
              <div className="hash-string-box">
                <span>Server Hash: {truncateHash(activeSeed.serverSeedHash)}</span>
                <button
                  type="button"
                  className="copy-hash-btn"
                  onClick={() => copyToClipboard(activeSeed.serverSeedHash)}
                >
                  Copy
                </button>
              </div>
              <button
                type="button"
                className="rotate-seed-btn"
                onClick={() => onRotateSeed()}
              >
                Rotate Client Seed
              </button>
            </div>
          )}

          {/* Seed History */}
          <h4>Seed History ({seeds.length})</h4>
          <div className="seed-history-list">
            {seeds.map((item) => (
              <div key={item.id} className="history-item-card">
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem" }}>
                  <span>Rounds: {item.nonceCount}</span>
                  <span style={{ color: item.status === "active" ? "#8b5cf6" : "#9ca3af" }}>
                    {item.status}
                  </span>
                </div>
                <div className="hash-string-box">
                  <span>{truncateHash(item.serverSeedHash)}</span>
                  <button
                    type="button"
                    className="copy-hash-btn"
                    onClick={() => copyToClipboard(item.serverSeedHash)}
                  >
                    Copy
                  </button>
                </div>
                {item.explorerUrl && (
                  <a
                    href={item.explorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: "0.75rem", color: "#60a5fa" }}
                  >
                    Verify on Explorer &rarr;
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
};
