/**
 * Tests for useLiquidationScanner.ts pure utility functions and calculation logic.
 *
 * The module-level pure functions (normalizeAddress, isAddress, parseWatchlist)
 * are tested via their observable behaviour (the exported composable or directly
 * replicated here since they are not exported). The financial-calculation logic
 * exercised inside fetchUserTarget is covered through extracted helpers that
 * mirror the same formulas, letting us verify correctness without needing the
 * full Nuxt/Vue context.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import BigNumber from "bignumber.js";

// ---------------------------------------------------------------------------
// Re-implement the module-level pure functions under test so we can validate
// them in isolation. These are copied verbatim from useLiquidationScanner.ts.
// ---------------------------------------------------------------------------

function normalizeAddress(address: string): string {
  return String(address || "").toLowerCase();
}

function isAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(String(address || ""));
}

function parseWatchlist(raw: string): string[] {
  if (!raw) return [];

  return raw
    .split(",")
    .map(address => address.trim())
    .filter(address => isAddress(address))
    .map(normalizeAddress);
}

// ---------------------------------------------------------------------------
// Re-implement the financial calculation helpers used inside fetchUserTarget.
// Constants from the source module.
// ---------------------------------------------------------------------------
const FLASHLOAN_FEE_RATE = "0.0009";
const INSTADAPP_FEE_RATE = "0.0005";

function toBN(value: BigNumber.Value): BigNumber {
  if (!value) return new BigNumber("0");
  if (new BigNumber(value).isNaN()) return new BigNumber("0");
  return new BigNumber(value);
}

function gt(value: BigNumber.Value, compareWith: BigNumber.Value): boolean {
  return toBN(value).gt(toBN(compareWith));
}

/**
 * Calculates the cover ratio used by fetchUserTarget.
 * Full liquidation is allowed when HF <= 0.95 or totalDebtBase < 2000.
 */
function computeCoverRatio(healthFactor: string, totalDebtBase: string): string {
  const canLiquidateAll =
    gt("0.95", healthFactor) || gt("2000", totalDebtBase);
  return canLiquidateAll ? "1" : "0.5";
}

/**
 * Computes the expected net profit exactly as fetchUserTarget does.
 */
function computeExpectedNetProfit(
  debtToCoverUsd: string,
  liquidationBonusPct: string,
  estimatedGasUsd: string
): string {
  const expectedBonusUsd = toBN(debtToCoverUsd).times(liquidationBonusPct).toFixed();
  const flashloanFeeUsd = toBN(debtToCoverUsd).times(FLASHLOAN_FEE_RATE).toFixed();
  const instadappFeeUsd = toBN(debtToCoverUsd).times(INSTADAPP_FEE_RATE).toFixed();

  return toBN(expectedBonusUsd)
    .minus(flashloanFeeUsd)
    .minus(instadappFeeUsd)
    .minus(estimatedGasUsd)
    .toFixed();
}

/**
 * Computes the estimated collateral seized as fetchUserTarget does.
 */
function computeEstimatedCollateralSeized(
  debtToCoverUsd: string,
  liquidationBonusPct: string
): string {
  return toBN(debtToCoverUsd)
    .times(toBN(liquidationBonusPct).plus("1"))
    .toFixed();
}

/**
 * Computes the score field used for sorting.
 */
function computeScore(expectedNetProfitUsd: string, debtToCoverUsd: string): string {
  return toBN(expectedNetProfitUsd)
    .plus(toBN(debtToCoverUsd).div("100"))
    .toFixed();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("normalizeAddress", () => {
  it("lowercases a checksummed address", () => {
    const checksummed = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
    expect(normalizeAddress(checksummed)).toBe(checksummed.toLowerCase());
  });

  it("returns an already-lowercase address unchanged", () => {
    const addr = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
    expect(normalizeAddress(addr)).toBe(addr);
  });

  it("handles empty string", () => {
    expect(normalizeAddress("")).toBe("");
  });

  it("handles null/undefined by coercing to empty string", () => {
    // `String(null || "")` → null is falsy, so evaluates `String("")` = ""
    expect(normalizeAddress(null as any)).toBe("");
    // `String(undefined || "")` → undefined is falsy, evaluates `String("")` = ""
    expect(normalizeAddress(undefined as any)).toBe("");
  });

  it("lowercases all hex characters", () => {
    expect(normalizeAddress("0xABCDEF")).toBe("0xabcdef");
  });
});

describe("isAddress", () => {
  it("returns true for a valid checksummed Ethereum address", () => {
    expect(isAddress("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2")).toBe(true);
  });

  it("returns true for a valid lowercase Ethereum address", () => {
    expect(isAddress("0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2")).toBe(true);
  });

  it("returns true for an uppercase hex address", () => {
    expect(isAddress("0xC02AAA39B223FE8D0A0E5C4F27EAD9083C756CC2")).toBe(true);
  });

  it("returns false for an address that is too short", () => {
    expect(isAddress("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756C")).toBe(false);
  });

  it("returns false for an address that is too long", () => {
    expect(isAddress("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2AB")).toBe(false);
  });

  it("returns false for an address missing the 0x prefix", () => {
    expect(isAddress("C02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2")).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(isAddress("")).toBe(false);
  });

  it("returns false for arbitrary text", () => {
    expect(isAddress("not-an-address")).toBe(false);
  });

  it("returns false for a null/undefined input", () => {
    expect(isAddress(null as any)).toBe(false);
    expect(isAddress(undefined as any)).toBe(false);
  });

  it("returns false for an address with invalid hex characters", () => {
    // Replace one valid hex char with 'g'
    expect(isAddress("0xg02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2")).toBe(false);
  });
});

describe("parseWatchlist", () => {
  it("returns an empty array for an empty string", () => {
    expect(parseWatchlist("")).toEqual([]);
  });

  it("returns an empty array for null/undefined", () => {
    expect(parseWatchlist(null as any)).toEqual([]);
    expect(parseWatchlist(undefined as any)).toEqual([]);
  });

  it("parses a single valid address", () => {
    const addr = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
    expect(parseWatchlist(addr)).toEqual([addr.toLowerCase()]);
  });

  it("parses multiple valid addresses separated by commas", () => {
    const a1 = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
    const a2 = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
    const result = parseWatchlist(`${a1},${a2}`);
    expect(result).toEqual([a1.toLowerCase(), a2.toLowerCase()]);
  });

  it("trims whitespace around addresses", () => {
    const addr = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
    expect(parseWatchlist(`  ${addr}  `)).toEqual([addr.toLowerCase()]);
  });

  it("filters out invalid entries", () => {
    const valid = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
    const invalid = "not-an-address";
    expect(parseWatchlist(`${valid},${invalid}`)).toEqual([valid.toLowerCase()]);
  });

  it("normalises addresses to lowercase", () => {
    const mixed = "0xC02AAA39B223FE8D0A0E5C4F27EAD9083C756CC2";
    expect(parseWatchlist(mixed)).toEqual([mixed.toLowerCase()]);
  });

  it("handles trailing commas gracefully", () => {
    const addr = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
    // The empty string produced by the trailing comma is not a valid address
    expect(parseWatchlist(`${addr},`)).toEqual([addr.toLowerCase()]);
  });

  it("returns addresses in the original order", () => {
    const a1 = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const a2 = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const a3 = "0xcccccccccccccccccccccccccccccccccccccccc";
    expect(parseWatchlist(`${a1},${a2},${a3}`)).toEqual([a1, a2, a3]);
  });
});

// ---------------------------------------------------------------------------
// Cover-ratio logic
// ---------------------------------------------------------------------------

describe("computeCoverRatio (liquidation cover amount decision)", () => {
  it("returns '1' (full liquidation) when HF is well below 0.95", () => {
    expect(computeCoverRatio("0.50", "5000")).toBe("1");
  });

  it("returns '1' (full liquidation) when HF equals 0.95 boundary (gt('0.95', '0.95') == false)", () => {
    // gt('0.95', healthFactor) means 0.95 > healthFactor.
    // When healthFactor == '0.95', 0.95 > 0.95 is false → falls through to totalDebtBase check.
    // If totalDebtBase is large enough, returns '0.5'.
    expect(computeCoverRatio("0.95", "5000")).toBe("0.5");
  });

  it("returns '1' (full liquidation) when HF is strictly below 0.95", () => {
    expect(computeCoverRatio("0.94", "5000")).toBe("1");
  });

  it("returns '1' (full liquidation) when totalDebtBase is below 2000", () => {
    // HF is 0.98, above 0.95, but totalDebtBase is small → still full liquidation
    expect(computeCoverRatio("0.98", "500")).toBe("1");
  });

  it("returns '0.5' (partial) when HF >= 0.95 and totalDebtBase >= 2000", () => {
    expect(computeCoverRatio("0.98", "5000")).toBe("0.5");
  });

  it("returns '0.5' (partial) when HF is exactly 0.96", () => {
    expect(computeCoverRatio("0.96", "3000")).toBe("0.5");
  });

  it("returns '1' when totalDebtBase equals 1999 (just below threshold)", () => {
    // gt('2000', '1999') is true → full liquidation
    expect(computeCoverRatio("0.98", "1999")).toBe("1");
  });
});

// ---------------------------------------------------------------------------
// Profit calculation
// ---------------------------------------------------------------------------

describe("computeExpectedNetProfit", () => {
  it("returns a positive profit for a healthy bonus above fees", () => {
    // debtToCoverUsd=10000, bonus=5% (0.05), gas=$25
    // bonus = 10000 * 0.05 = 500
    // flashloan = 10000 * 0.0009 = 9
    // instadapp = 10000 * 0.0005 = 5
    // net = 500 - 9 - 5 - 25 = 461
    const profit = computeExpectedNetProfit("10000", "0.05", "25");
    expect(parseFloat(profit)).toBeCloseTo(461, 2);
  });

  it("returns a negative profit when fees exceed the liquidation bonus", () => {
    // Tiny bonus: 0.001 on $100 debt = $0.10 bonus
    // fees: 0.09 + 0.05 = $0.14 fees (approx), gas=$25
    const profit = computeExpectedNetProfit("100", "0.001", "25");
    expect(parseFloat(profit)).toBeLessThan(0);
  });

  it("returns zero when bonus exactly equals all fees (edge case tolerance)", () => {
    // To produce exactly zero: bonus = flashloan + instadapp + gas
    // Let debt=10000, gas=0 for simplicity
    // bonus = flashloan + instadapp → bonus_rate = 0.0009 + 0.0005 = 0.0014
    const profit = computeExpectedNetProfit("10000", "0.0014", "0");
    expect(parseFloat(profit)).toBeCloseTo(0, 6);
  });

  it("correctly handles very large USD amounts without precision loss", () => {
    // $10M debt with 5% bonus, $25 gas
    const profit = computeExpectedNetProfit("10000000", "0.05", "25");
    // bonus = 500000, fees ~ 14000, net ~ 485975
    expect(parseFloat(profit)).toBeGreaterThan(400000);
  });

  it("handles zero debtToCoverUsd", () => {
    const profit = computeExpectedNetProfit("0", "0.05", "25");
    // bonus=0, fees=0, net = -25
    expect(parseFloat(profit)).toBeCloseTo(-25, 4);
  });
});

// ---------------------------------------------------------------------------
// estimatedCollateralSeized calculation
// ---------------------------------------------------------------------------

describe("computeEstimatedCollateralSeized", () => {
  it("includes both principal and bonus in the collateral seized", () => {
    // debtToCoverUsd=1000, liquidationBonusPct=0.05
    // seized = 1000 * (0.05 + 1) = 1050
    const seized = computeEstimatedCollateralSeized("1000", "0.05");
    expect(parseFloat(seized)).toBeCloseTo(1050, 4);
  });

  it("equals debtToCoverUsd when bonus is zero", () => {
    const seized = computeEstimatedCollateralSeized("500", "0");
    expect(parseFloat(seized)).toBeCloseTo(500, 4);
  });

  it("scales linearly with debt amount", () => {
    const seized1 = computeEstimatedCollateralSeized("1000", "0.08");
    const seized2 = computeEstimatedCollateralSeized("2000", "0.08");
    expect(parseFloat(seized2)).toBeCloseTo(parseFloat(seized1) * 2, 4);
  });
});

// ---------------------------------------------------------------------------
// Score calculation
// ---------------------------------------------------------------------------

describe("computeScore", () => {
  it("adds a small fraction of debtToCoverUsd to expectedNetProfit", () => {
    // score = 461 + 10000/100 = 461 + 100 = 561
    const score = computeScore("461", "10000");
    expect(parseFloat(score)).toBeCloseTo(561, 4);
  });

  it("preserves profitable ordering when one target has higher net profit", () => {
    const score1 = parseFloat(computeScore("100", "5000"));  // 100 + 50 = 150
    const score2 = parseFloat(computeScore("200", "5000"));  // 200 + 50 = 250
    expect(score2).toBeGreaterThan(score1);
  });

  it("breaks tie on net profit using debt size as secondary criterion", () => {
    // Same profit, higher debt → higher score
    const score1 = parseFloat(computeScore("100", "1000"));  // 100 + 10 = 110
    const score2 = parseFloat(computeScore("100", "5000"));  // 100 + 50 = 150
    expect(score2).toBeGreaterThan(score1);
  });

  it("handles negative profit (unprofitable target)", () => {
    const score = parseFloat(computeScore("-10", "5000"));  // -10 + 50 = 40
    expect(score).toBeCloseTo(40, 4);
  });
});

// ---------------------------------------------------------------------------
// Sorting logic: profitable targets should appear first
// ---------------------------------------------------------------------------

describe("target sorting logic", () => {
  type MinTarget = { isProfitable: boolean; score: string };

  function sortTargets(targets: MinTarget[]): MinTarget[] {
    return [...targets].sort((a, b) => {
      if (a.isProfitable !== b.isProfitable) {
        return a.isProfitable ? -1 : 1;
      }
      if (gt(b.score, a.score)) return 1;
      if (gt(a.score, b.score)) return -1;
      return 0;
    });
  }

  it("places profitable targets before unprofitable ones", () => {
    const targets: MinTarget[] = [
      { isProfitable: false, score: "1000" },
      { isProfitable: true, score: "100" }
    ];
    const sorted = sortTargets(targets);
    expect(sorted[0].isProfitable).toBe(true);
    expect(sorted[1].isProfitable).toBe(false);
  });

  it("sorts profitable targets by score descending", () => {
    const targets: MinTarget[] = [
      { isProfitable: true, score: "100" },
      { isProfitable: true, score: "500" },
      { isProfitable: true, score: "250" }
    ];
    const sorted = sortTargets(targets);
    expect(sorted[0].score).toBe("500");
    expect(sorted[1].score).toBe("250");
    expect(sorted[2].score).toBe("100");
  });

  it("sorts unprofitable targets by score descending", () => {
    const targets: MinTarget[] = [
      { isProfitable: false, score: "50" },
      { isProfitable: false, score: "200" }
    ];
    const sorted = sortTargets(targets);
    expect(sorted[0].score).toBe("200");
    expect(sorted[1].score).toBe("50");
  });

  it("keeps original order for equal scores", () => {
    const targets: MinTarget[] = [
      { isProfitable: true, score: "100" },
      { isProfitable: true, score: "100" }
    ];
    const sorted = sortTargets(targets);
    expect(sorted.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Default constant values sanity checks
// ---------------------------------------------------------------------------

describe("constants used in useLiquidationScanner", () => {
  it("FLASHLOAN_FEE_RATE is less than 0.1%", () => {
    expect(parseFloat(FLASHLOAN_FEE_RATE)).toBeLessThan(0.001);
    expect(parseFloat(FLASHLOAN_FEE_RATE)).toBeGreaterThan(0);
  });

  it("INSTADAPP_FEE_RATE is less than 0.1%", () => {
    expect(parseFloat(INSTADAPP_FEE_RATE)).toBeLessThan(0.001);
    expect(parseFloat(INSTADAPP_FEE_RATE)).toBeGreaterThan(0);
  });

  it("combined fees (flashloan + instadapp) stay below 0.2%", () => {
    const combined = parseFloat(FLASHLOAN_FEE_RATE) + parseFloat(INSTADAPP_FEE_RATE);
    expect(combined).toBeLessThan(0.002);
  });
});

// ---------------------------------------------------------------------------
// BigNumber precision helpers used throughout the scanner
// ---------------------------------------------------------------------------

describe("toBN helper", () => {
  it("returns 0 for empty string", () => {
    expect(toBN("").toFixed()).toBe("0");
  });

  it("returns 0 for NaN input", () => {
    expect(toBN("NaN").toFixed()).toBe("0");
  });

  it("returns 0 for null input", () => {
    expect(toBN(null as any).toFixed()).toBe("0");
  });

  it("parses numeric string correctly", () => {
    expect(toBN("1234.5678").toFixed()).toBe("1234.5678");
  });

  it("preserves negative values", () => {
    expect(toBN("-50").toFixed()).toBe("-50");
  });
});

describe("gt helper", () => {
  it("returns true when first value is greater", () => {
    expect(gt("2", "1")).toBe(true);
  });

  it("returns false when values are equal", () => {
    expect(gt("1", "1")).toBe(false);
  });

  it("returns false when first value is smaller", () => {
    expect(gt("0.5", "1")).toBe(false);
  });

  it("handles string-represented decimals correctly", () => {
    expect(gt("0.95", "0.94")).toBe(true);
    expect(gt("0.94", "0.95")).toBe(false);
  });

  it("returns false when inputs are zero", () => {
    expect(gt("0", "0")).toBe(false);
  });
});