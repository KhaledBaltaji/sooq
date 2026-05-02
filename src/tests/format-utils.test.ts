/**
 * format-utils.test.ts — Tests for share price formatting functions.
 * Verifies 1-decimal precision for all price displays.
 */

import { describe, it, expect } from "vitest";
import { formatSharePrice, formatPrice } from "../lib/market-utils";

describe("formatSharePrice (1-decimal precision)", () => {
  it("returns 0% for zero price", () => {
    expect(formatSharePrice(0)).toBe("0%");
  });

  it("returns 100% for price = 1", () => {
    expect(formatSharePrice(1)).toBe("100%");
  });

  it("shows 1 decimal place for fractional prices", () => {
    expect(formatSharePrice(0.213)).toBe("21.3%");
  });

  it("handles near-100 edge case", () => {
    expect(formatSharePrice(0.999)).toBe("99.9%");
  });

  it("handles exact percentage", () => {
    expect(formatSharePrice(0.5)).toBe("50.0%");
  });

  it("handles near-zero price", () => {
    expect(formatSharePrice(0.001)).toBe("0.1%");
  });
});

describe("formatPrice (1-decimal precision)", () => {
  it("buy context shows 1 decimal", () => {
    expect(formatPrice(0.213, "buy")).toBe("21.3%");
  });

  it("sell context shows 1 decimal", () => {
    expect(formatPrice(0.213, "sell")).toBe("21.3%");
  });

  it("neutral context shows 1 decimal", () => {
    expect(formatPrice(0.213, "neutral")).toBe("21.3%");
  });

  it("near-zero edge", () => {
    expect(formatPrice(0.001, "buy")).toBe("0.1%");
  });

  it("near-100 edge", () => {
    expect(formatPrice(0.999, "sell")).toBe("99.9%");
  });

  it("exact value shows .0", () => {
    expect(formatPrice(0.5, "buy")).toBe("50.0%");
    expect(formatPrice(0.5, "sell")).toBe("50.0%");
    expect(formatPrice(0.5, "neutral")).toBe("50.0%");
  });

  it("boundary: 0 and 100", () => {
    expect(formatPrice(0, "buy")).toBe("0%");
    expect(formatPrice(1, "sell")).toBe("100%");
  });
});
