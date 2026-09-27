import React, { useState, useEffect } from "react";
import { PayoutCalculatorSliderProps, PayoutProjection } from "./types";
import "./PayoutCalculatorSlider.css";

const MULTIPLIER_PRESETS = [1.5, 2, 5, 10, 50];

export const PayoutCalculatorSlider: React.FC<PayoutCalculatorSliderProps> = ({
  initialWager = 10,
  houseEdgePct = 2,
  maxWager = 1000,
  minWager = 1,
  userBalance = 500,
  onWagerChange,
  className = "",
}) => {
  const [wager, setWager] = useState<number>(initialWager);
  const [multiplier, setMultiplier] = useState<number>(2);

  const clampWager = (val: number): number => {
    if (isNaN(val) || val < minWager) return minWager;
    if (val > maxWager) return maxWager;
    return val;
  };

  const calculateProjection = (w: number, m: number): PayoutProjection => {
    const gross = Math.round(w * m * 100) / 100;
    const fee = Math.round((gross * (houseEdgePct / 100)) * 100) / 100;
    const net = Math.round((gross - fee) * 100) / 100;
    const profit = Math.round((net - w) * 100) / 100;

    return {
      wagerAmount: w,
      multiplier: m,
      houseEdgePct,
      grossPayout: gross,
      feeAmount: fee,
      netPayout: net,
      netProfit: profit,
    };
  };

  const projection = calculateProjection(wager, multiplier);

  useEffect(() => {
    if (onWagerChange) {
      onWagerChange(projection);
    }
  }, [wager, multiplier, houseEdgePct]);

  const handleWagerInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const parsed = parseFloat(e.target.value);
    setWager(clampWager(parsed));
  };

  const handlePresetWager = (pct: number) => {
    const calculated = Math.round((userBalance * pct) * 100) / 100;
    setWager(clampWager(calculated));
  };

  return (
    <div className={`payout-calculator-card ${className}`}>
      <h3>Payout Calculator</h3>

      {/* Wager Input & Slider */}
      <div className="wager-input-group">
        <label htmlFor="wager-amount-input" className="projection-row">
          <span>Wager Amount (XLM)</span>
          <span>Max: {maxWager} XLM</span>
        </label>
        <input
          id="wager-amount-input"
          type="number"
          aria-label="Wager Amount Input"
          className="wager-number-input"
          value={wager}
          min={minWager}
          max={maxWager}
          step={1}
          onChange={handleWagerInput}
        />
        <input
          type="range"
          aria-label="Wager Amount Slider"
          className="wager-range-slider"
          value={wager}
          min={minWager}
          max={maxWager}
          step={1}
          onChange={(e) => setWager(clampWager(parseFloat(e.target.value)))}
        />
      </div>

      {/* Quick Wager Presets */}
      <div className="multiplier-presets-strip">
        <button type="button" className="preset-pill-btn" onClick={() => setWager(minWager)}>
          Min
        </button>
        <button type="button" className="preset-pill-btn" onClick={() => handlePresetWager(0.25)}>
          25%
        </button>
        <button type="button" className="preset-pill-btn" onClick={() => handlePresetWager(0.5)}>
          50%
        </button>
        <button type="button" className="preset-pill-btn" onClick={() => setWager(clampWager(userBalance))}>
          Max
        </button>
      </div>

      {/* Multipliers */}
      <div className="wager-input-group">
        <span className="projection-row">Multiplier</span>
        <div className="multiplier-presets-strip">
          {MULTIPLIER_PRESETS.map((m) => (
            <button
              key={m}
              type="button"
              className={`preset-pill-btn ${multiplier === m ? "active" : ""}`}
              onClick={() => setMultiplier(m)}
            >
              {m}x
            </button>
          ))}
        </div>
      </div>

      {/* Breakdown */}
      <div className="projection-summary-box">
        <div className="projection-row">
          <span>Gross Payout:</span>
          <span>{projection.grossPayout.toFixed(2)} XLM</span>
        </div>
        <div className="projection-row">
          <span>House Edge ({houseEdgePct}%):</span>
          <span>-{projection.feeAmount.toFixed(2)} XLM</span>
        </div>
        <div className="projection-row highlight">
          <span>Net Profit:</span>
          <span>+{projection.netProfit.toFixed(2)} XLM</span>
        </div>
      </div>
    </div>
  );
};
