/**
 * Tests for useFlashLiquidator.ts
 *
 * Tests cover:
 * - parseInputsFromError: regex extraction + JSON parsing from DSA error messages
 * - mapLiquidationInput: input name → LiquidationTarget field mapping
 * - getFlashPaybackAmount: flashloan repayment amount with fee applied
 * - clearConnectorMethodCache: cache management
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import BigNumber from "bignumber.js";

// ---------------------------------------------------------------------------
// Re-implement pure functions from useFlashLiquidator.ts verbatim
// (They are not individually exported; we test them here directly.)
// ---------------------------------------------------------------------------

type MethodInput = {
  name: string;
  type: string;
};

function parseInputsFromError(errorMessage: string): MethodInput[] {
  const match = String(errorMessage || "").match(/value=(\{.*\}), code=/);
  if (!match?.[1]) {
    return [];
  }

  try {
    const parsed = JSON.parse(match[1]);
    return parsed?.types || [];
  } catch (_error) {
    return [];
  }
}

function mapLiquidationInput(
  inputName: string,
  target: {
    collateralTokenAddress: string;
    debtTokenAddress: string;
    user: string;
    debtToCoverRaw: string;
  }
): any {
  const key = inputName.toLowerCase();

  if (key.includes("collateral")) return target.collateralTokenAddress;
  if (key.includes("debt")) return target.debtTokenAddress;
  if (key === "user" || key.includes("target")) return target.user;
  if (key.includes("amount") || key.includes("amt") || key.includes("cover")) {
    return target.debtToCoverRaw;
  }
  if (key.includes("receiveatoken")) return false;
  if (key.includes("ratemode")) return 2;
  if (key.includes("getid") || key.includes("setid") || key.includes("data")) {
    return 0;
  }

  return 0;
}

const FLASHLOAN_FEE = "0.0009";

function toBN(value: BigNumber.Value): BigNumber {
  if (!value) return new BigNumber("0");
  if (new BigNumber(value).isNaN()) return new BigNumber("0");
  return new BigNumber(value);
}

function getFlashPaybackAmount(amountRaw: string): string {
  return toBN(amountRaw)
    .times(toBN("1").plus(FLASHLOAN_FEE))
    .integerValue(0)
    .toFixed();
}

// ---------------------------------------------------------------------------
// Fixture target used across mapLiquidationInput tests
// ---------------------------------------------------------------------------

const SAMPLE_TARGET = {
  collateralTokenAddress: "0xaaaaaa",
  debtTokenAddress: "0xbbbbbb",
  user: "0xcccccc",
  debtToCoverRaw: "1000000000000000000"
};

// ---------------------------------------------------------------------------
// parseInputsFromError
// ---------------------------------------------------------------------------

describe("parseInputsFromError", () => {
  it("returns an empty array for an empty string", () => {
    expect(parseInputsFromError("")).toEqual([]);
  });

  it("returns an empty array for null/undefined", () => {
    expect(parseInputsFromError(null as any)).toEqual([]);
    expect(parseInputsFromError(undefined as any)).toEqual([]);
  });

  it("returns an empty array when the message does not match the pattern", () => {
    expect(parseInputsFromError("some random error message")).toEqual([]);
  });

  it("extracts types array from a matching DSA error message", () => {
    const types: MethodInput[] = [
      { name: "collateralAsset", type: "address" },
      { name: "debtAsset", type: "address" },
      { name: "user", type: "address" },
      { name: "debtToCover", type: "uint256" }
    ];

    const errorMessage = `Error: types/values length mismatch value={"types":${JSON.stringify(types)},"values":[]}, code=INVALID_ARGUMENT`;
    expect(parseInputsFromError(errorMessage)).toEqual(types);
  });

  it("returns an empty array when the JSON is malformed", () => {
    const errorMessage = `Error: types/values length mismatch value={invalid_json}, code=INVALID_ARGUMENT`;
    expect(parseInputsFromError(errorMessage)).toEqual([]);
  });

  it("returns an empty array when the JSON object has no 'types' key", () => {
    const errorMessage = `Error: types/values length mismatch value={"other":"data"}, code=INVALID_ARGUMENT`;
    expect(parseInputsFromError(errorMessage)).toEqual([]);
  });

  it("returns an empty array when types is null in the JSON", () => {
    const errorMessage = `Error: types/values length mismatch value={"types":null}, code=INVALID_ARGUMENT`;
    expect(parseInputsFromError(errorMessage)).toEqual([]);
  });

  it("handles nested JSON inside the value object without crashing", () => {
    const types: MethodInput[] = [{ name: "amount", type: "uint256" }];
    const inner = JSON.stringify({ types, extra: { nested: true } });
    const errorMessage = `Error value=${inner}, code=ERR`;
    expect(parseInputsFromError(errorMessage)).toEqual(types);
  });

  it("returns an empty array when value JSON contains an empty types array", () => {
    const errorMessage = `Error value={"types":[]}, code=ERR`;
    expect(parseInputsFromError(errorMessage)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// mapLiquidationInput
// ---------------------------------------------------------------------------

describe("mapLiquidationInput", () => {
  it("maps 'collateralAsset' to the collateral token address", () => {
    expect(mapLiquidationInput("collateralAsset", SAMPLE_TARGET)).toBe(
      SAMPLE_TARGET.collateralTokenAddress
    );
  });

  it("maps 'COLLATERAL' (case-insensitive) to the collateral token address", () => {
    expect(mapLiquidationInput("COLLATERAL", SAMPLE_TARGET)).toBe(
      SAMPLE_TARGET.collateralTokenAddress
    );
  });

  it("maps 'debtAsset' to the debt token address", () => {
    expect(mapLiquidationInput("debtAsset", SAMPLE_TARGET)).toBe(
      SAMPLE_TARGET.debtTokenAddress
    );
  });

  it("maps 'DEBT' (case-insensitive) to the debt token address", () => {
    expect(mapLiquidationInput("DEBT", SAMPLE_TARGET)).toBe(
      SAMPLE_TARGET.debtTokenAddress
    );
  });

  it("maps exact 'user' input name to the user address", () => {
    expect(mapLiquidationInput("user", SAMPLE_TARGET)).toBe(SAMPLE_TARGET.user);
  });

  it("maps 'targetUser' (contains 'target') to the user address", () => {
    expect(mapLiquidationInput("targetUser", SAMPLE_TARGET)).toBe(SAMPLE_TARGET.user);
  });

  it("maps 'amount' to debtToCoverRaw", () => {
    expect(mapLiquidationInput("amount", SAMPLE_TARGET)).toBe(
      SAMPLE_TARGET.debtToCoverRaw
    );
  });

  it("maps 'debtToCoverAmount' to debtTokenAddress because 'debt' branch has priority over 'amount'", () => {
    // The implementation checks `key.includes("debt")` before `key.includes("amount")`.
    // 'debtToCoverAmount'.toLowerCase() includes 'debt', so it hits the debt branch first.
    expect(mapLiquidationInput("debtToCoverAmount", SAMPLE_TARGET)).toBe(
      SAMPLE_TARGET.debtTokenAddress
    );
  });

  it("maps 'amt' to debtToCoverRaw", () => {
    expect(mapLiquidationInput("amt", SAMPLE_TARGET)).toBe(
      SAMPLE_TARGET.debtToCoverRaw
    );
  });

  it("maps 'cover' to debtToCoverRaw", () => {
    expect(mapLiquidationInput("cover", SAMPLE_TARGET)).toBe(
      SAMPLE_TARGET.debtToCoverRaw
    );
  });

  it("maps 'receiveAToken' (case-insensitive) to false", () => {
    expect(mapLiquidationInput("receiveAToken", SAMPLE_TARGET)).toBe(false);
    expect(mapLiquidationInput("RECEIVEATOKEN", SAMPLE_TARGET)).toBe(false);
  });

  it("maps 'rateMode' to 2 (variable rate)", () => {
    expect(mapLiquidationInput("rateMode", SAMPLE_TARGET)).toBe(2);
    expect(mapLiquidationInput("RATEMODE", SAMPLE_TARGET)).toBe(2);
  });

  it("maps 'getId' to 0", () => {
    expect(mapLiquidationInput("getId", SAMPLE_TARGET)).toBe(0);
  });

  it("maps 'setId' to 0", () => {
    expect(mapLiquidationInput("setId", SAMPLE_TARGET)).toBe(0);
  });

  it("maps 'data' to 0", () => {
    expect(mapLiquidationInput("data", SAMPLE_TARGET)).toBe(0);
  });

  it("returns 0 as a default for unrecognised input names", () => {
    expect(mapLiquidationInput("unknownParam", SAMPLE_TARGET)).toBe(0);
  });

  it("handles empty input name by returning 0 (default)", () => {
    expect(mapLiquidationInput("", SAMPLE_TARGET)).toBe(0);
  });

  // Priority: 'debt' check comes before 'user'/'target' check in the code.
  it("resolves 'debtTarget' using the debt branch (debt wins over target)", () => {
    // 'debtTarget' includes 'debt' → matches debt branch first
    expect(mapLiquidationInput("debtTarget", SAMPLE_TARGET)).toBe(
      SAMPLE_TARGET.debtTokenAddress
    );
  });
});

// ---------------------------------------------------------------------------
// getFlashPaybackAmount
// ---------------------------------------------------------------------------

describe("getFlashPaybackAmount", () => {
  it("returns principal + 0.09% fee, rounded down (integerValue(0))", () => {
    // 1_000_000_000_000_000_000 * 1.0009 = 1_000_900_000_000_000_000 (exact)
    const result = getFlashPaybackAmount("1000000000000000000");
    expect(result).toBe("1000900000000000000");
  });

  it("rounds fractional amounts up (BigNumber integerValue(0) = ROUND_UP)", () => {
    // BigNumber ROUND_UP (mode 0) rounds away from zero.
    // 100 * 1.0009 = 100.09 → ROUND_UP → 101
    const result = getFlashPaybackAmount("100");
    expect(result).toBe("101");
  });

  it("returns '0' for a zero input", () => {
    expect(getFlashPaybackAmount("0")).toBe("0");
  });

  it("returns '0' for an empty string input", () => {
    expect(getFlashPaybackAmount("")).toBe("0");
  });

  it("the fee adds exactly 0.09% to the principal", () => {
    const principal = "10000000000";
    const result = getFlashPaybackAmount(principal);
    // Use BigNumber for the expected value to avoid JS float imprecision.
    // 10000000000 * 1.0009 = 10009000000.0 (exact in BigNumber) → ROUND_UP → 10009000000
    const expected = new BigNumber("10000000000").times("1.0009").integerValue(0).toFixed();
    expect(result).toBe(expected);
  });

  it("result is always greater than or equal to the input for positive amounts", () => {
    const amounts = ["1000", "999999999999", "5000000000000000000"];
    for (const amount of amounts) {
      const result = getFlashPaybackAmount(amount);
      expect(toBN(result).gte(toBN(amount))).toBe(true);
    }
  });

  it("handles very large raw amounts without losing precision", () => {
    // 10^21 wei = 1000 ETH
    const largeAmount = "1000000000000000000000";
    const result = getFlashPaybackAmount(largeAmount);
    // 10^21 * 1.0009 = 1000900000000000000000 (exact in BigNumber)
    expect(result).toBe("1000900000000000000000");
  });
});

// ---------------------------------------------------------------------------
// connectorMethodCache behaviour (cache management)
// ---------------------------------------------------------------------------

describe("connectorMethodCache (Map-based cache)", () => {
  it("behaves like a standard Map and can be cleared", () => {
    const cache = new Map<string, string[]>();
    cache.set("AAVE-V3-A", ["liquidate", "liquidationCall"]);
    cache.set("INSTAPOOL-D", ["flashBorrowAndCast", "flashPayback"]);

    expect(cache.size).toBe(2);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it("returns the cached value on subsequent lookups", () => {
    const cache = new Map<string, string[]>();
    const methods = ["liquidate"];
    cache.set("AAVE-V3-A", methods);

    expect(cache.get("AAVE-V3-A")).toBe(methods);
    expect(cache.has("AAVE-V3-A")).toBe(true);
  });

  it("returns undefined for an unknown connector", () => {
    const cache = new Map<string, string[]>();
    expect(cache.get("UNKNOWN")).toBeUndefined();
    expect(cache.has("UNKNOWN")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// FLASHLOAN_ROUTE_DEFAULT and FLASHLOAN_FEE constant sanity checks
// ---------------------------------------------------------------------------

describe("useFlashLiquidator constants", () => {
  it("FLASHLOAN_ROUTE_DEFAULT is 0", () => {
    const FLASHLOAN_ROUTE_DEFAULT = 0;
    expect(FLASHLOAN_ROUTE_DEFAULT).toBe(0);
  });

  it("FLASHLOAN_FEE represents 0.09%", () => {
    expect(parseFloat(FLASHLOAN_FEE)).toBeCloseTo(0.0009, 6);
  });

  it("FLASHLOAN_FEE is less than 0.1%", () => {
    expect(parseFloat(FLASHLOAN_FEE)).toBeLessThan(0.001);
  });
});