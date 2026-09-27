import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PayoutCalculatorSlider } from "./PayoutCalculatorSlider";

describe("PayoutCalculatorSlider", () => {
  it("slider movement updates calculated net profit", () => {
    const onWagerChange = vi.fn();
    render(
      <PayoutCalculatorSlider
        initialWager={10}
        houseEdgePct={2}
        onWagerChange={onWagerChange}
      />
    );

    const slider = screen.getByRole("slider", { name: "Wager Amount Slider" });
    fireEvent.change(slider, { target: { value: "100" } });

    expect(onWagerChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        wagerAmount: 100,
        multiplier: 2,
        netProfit: 96,
      })
    );
  });

  it("multiplier preset click updates calculations", () => {
    const onWagerChange = vi.fn();
    render(
      <PayoutCalculatorSlider
        initialWager={10}
        houseEdgePct={2}
        onWagerChange={onWagerChange}
      />
    );

    const preset5x = screen.getByRole("button", { name: "5x" });
    fireEvent.click(preset5x);

    expect(onWagerChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        wagerAmount: 10,
        multiplier: 5,
        netProfit: 39,
      })
    );
  });

  it("invalid or negative wager input clamps to minimum", () => {
    const onWagerChange = vi.fn();
    render(
      <PayoutCalculatorSlider
        initialWager={10}
        minWager={1}
        onWagerChange={onWagerChange}
      />
    );

    const input = screen.getByRole("spinbutton", { name: "Wager Amount Input" });
    fireEvent.change(input, { target: { value: "-50" } });

    expect(onWagerChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        wagerAmount: 1,
      })
    );
  });
});
