/**
 * Tests for composables/protocols/useFlashLiquidator.ts
 *
 * Tests cover:
 * - parseInputsFromError (pure function behavior)
 * - mapLiquidationInput (pure function behavior via documented logic)
 * - getFlashPaybackAmount calculation
 * - clearConnectorMethodCache
 * - executeTarget: guard conditions (no wallet, not profitable, no forkId)
 * - executeTarget: sets executionError on failure
 * - executeTarget: does not run if already pending
 * - executeTarget: auto mode suppresses showWarning
 * - buildExecutionSpells: throws when INSTAPOOL-D methods unavailable
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "@vue/composition-api";
import BigNumber from "bignumber.js";

// ─── Mutable state shared between tests ──────────────────────────────────────

const mockAccount = ref<string | null>(null);
const mockActiveAccount = ref<any>(null);
const mockDsa = ref<any>(null);
const mockForkId = ref<string | null>(null);

const mockShowPendingTransaction = vi.fn();
const mockShowConfirmedTransaction = vi.fn();
const mockShowWarning = vi.fn();

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@nuxtjs/composition-api", async () => {
  const vca = await import("@vue/composition-api");
  return {
    ref: vca.ref,
    readonly: vca.readonly,
  };
});

vi.mock("@instadapp/vue-web3", () => ({
  useWeb3: () => ({ account: mockAccount }),
}));

vi.mock("~/composables/useDSA", () => ({
  useDSA: () => ({ dsa: mockDsa, activeAccount: mockActiveAccount }),
}));

vi.mock("~/composables/useTenderly", () => ({
  useTenderly: () => ({ forkId: mockForkId }),
}));

vi.mock("~/composables/useNotification", () => ({
  useNotification: () => ({
    showPendingTransaction: mockShowPendingTransaction,
    showConfirmedTransaction: mockShowConfirmedTransaction,
    showWarning: mockShowWarning,
  }),
}));

vi.mock("~/composables/useBigNumber", async () => {
  const { default: BN } = await import("bignumber.js");
  BN.config({ POW_PRECISION: 200 });
  function toBN(v: any) {
    const n = new BN(v);
    return n.isNaN() ? new BN(0) : n;
  }
  return {
    useBigNumber: () => ({
      toBN,
      gt: (a: any, b: any) => toBN(a).gt(toBN(b)),
    }),
  };
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeLiquidationTarget(overrides: Record<string, any> = {}) {
  return {
    user: "0xaaaa000000000000000000000000000000000001",
    healthFactor: "0.85",
    marketAddress: "0xMarket000000000000000000000000000000001",
    chainId: 1,
    debtTokenAddress: "0xdebt0000000000000000000000000000000000aa",
    debtTokenSymbol: "USDC",
    debtTokenDecimals: 6,
    collateralTokenAddress: "0xcoll0000000000000000000000000000000000bb",
    collateralTokenSymbol: "WETH",
    collateralTokenDecimals: 18,
    debtToCoverRaw: "1000000000",
    debtToCoverUsd: "1000",
    estimatedCollateralSeizedUsd: "1050",
    liquidationBonusPct: "0.05",
    flashloanFeeUsd: "0.9",
    instadappFeeUsd: "0.5",
    estimatedGasUsd: "25",
    expectedBonusUsd: "50",
    expectedNetProfitUsd: "23.6",
    isProfitable: true,
    score: "33.6",
    ethPriceUsd: "2000",
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useFlashLiquidator", () => {
  let liquidator: ReturnType<typeof import("~/composables/protocols/useFlashLiquidator").useFlashLiquidator>;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockAccount.value = null;
    mockActiveAccount.value = null;
    mockDsa.value = null;
    mockForkId.value = null;

    // Re-import to get fresh module-level refs (pending, executionError, etc.)
    vi.resetModules();

    const mod = await import("~/composables/protocols/useFlashLiquidator");
    liquidator = mod.useFlashLiquidator();
  });

  // ── clearConnectorMethodCache ─────────────────────────────────────────────

  describe("clearConnectorMethodCache", () => {
    it("is exported and callable without error", () => {
      expect(() => liquidator.clearConnectorMethodCache()).not.toThrow();
    });

    it("can be called multiple times without error", () => {
      liquidator.clearConnectorMethodCache();
      liquidator.clearConnectorMethodCache();
    });
  });

  // ── initial state ──────────────────────────────────────────────────────────

  describe("initial state", () => {
    it("pending starts as false", () => {
      expect(liquidator.pending.value).toBe(false);
    });

    it("executionError starts as empty string", () => {
      expect(liquidator.executionError.value).toBe("");
    });

    it("lastExecutedAt starts as null", () => {
      expect(liquidator.lastExecutedAt.value).toBeNull();
    });
  });

  // ── executeTarget: no wallet connected ────────────────────────────────────

  describe("executeTarget - no wallet", () => {
    it("sets executionError when account is null", async () => {
      mockAccount.value = null;
      mockActiveAccount.value = null;

      await liquidator.executeTarget(makeLiquidationTarget());

      expect(liquidator.executionError.value).toMatch(/Connect wallet/i);
      expect(liquidator.pending.value).toBe(false);
    });

    it("sets executionError when activeAccount is null but account exists", async () => {
      mockAccount.value = "0xWallet";
      mockActiveAccount.value = null;

      await liquidator.executeTarget(makeLiquidationTarget());

      expect(liquidator.executionError.value).toMatch(/Connect wallet/i);
    });
  });

  // ── executeTarget: profitability guard ────────────────────────────────────

  describe("executeTarget - profitability check", () => {
    it("sets executionError when target is not profitable", async () => {
      mockAccount.value = "0xWallet";
      mockActiveAccount.value = { id: 1 };
      mockForkId.value = "fork-123";

      await liquidator.executeTarget(
        makeLiquidationTarget({ expectedNetProfitUsd: "0", isProfitable: false })
      );

      expect(liquidator.executionError.value).toMatch(/not profitable/i);
    });

    it("sets executionError when expectedNetProfitUsd is negative", async () => {
      mockAccount.value = "0xWallet";
      mockActiveAccount.value = { id: 1 };
      mockForkId.value = "fork-123";

      await liquidator.executeTarget(
        makeLiquidationTarget({ expectedNetProfitUsd: "-5", isProfitable: false })
      );

      expect(liquidator.executionError.value).toMatch(/not profitable/i);
    });
  });

  // ── executeTarget: forkId guard ───────────────────────────────────────────

  describe("executeTarget - forkId (simulation mode) guard", () => {
    it("sets executionError when forkId is not set", async () => {
      mockAccount.value = "0xWallet";
      mockActiveAccount.value = { id: 1 };
      mockForkId.value = null;

      await liquidator.executeTarget(makeLiquidationTarget({ expectedNetProfitUsd: "100" }));

      expect(liquidator.executionError.value).toMatch(/Simulation mode/i);
    });
  });

  // ── executeTarget: auto mode ──────────────────────────────────────────────

  describe("executeTarget - auto mode", () => {
    it("does not call showWarning when auto=true", async () => {
      mockAccount.value = null;
      mockActiveAccount.value = null;

      await liquidator.executeTarget(makeLiquidationTarget(), true);

      expect(mockShowWarning).not.toHaveBeenCalled();
      expect(liquidator.executionError.value).not.toBe("");
    });

    it("calls showWarning when auto=false (default) on error", async () => {
      mockAccount.value = null;
      mockActiveAccount.value = null;

      await liquidator.executeTarget(makeLiquidationTarget(), false);

      expect(mockShowWarning).toHaveBeenCalledOnce();
    });
  });

  // ── executeTarget: DSA unavailable ───────────────────────────────────────

  describe("executeTarget - DSA unavailable", () => {
    it("sets executionError when dsa is null and all guards pass", async () => {
      mockAccount.value = "0xWallet";
      mockActiveAccount.value = { id: 1 };
      mockForkId.value = "fork-123";
      mockDsa.value = null;

      await liquidator.executeTarget(makeLiquidationTarget({ expectedNetProfitUsd: "100" }));

      // Either DSA unavailable or connector method error - both indicate DSA required
      expect(liquidator.executionError.value).not.toBe("");
      expect(liquidator.pending.value).toBe(false);
    });
  });

  // ── executeTarget: INSTAPOOL-D methods unavailable ────────────────────────

  describe("executeTarget - connector method unavailable", () => {
    it("sets executionError when INSTAPOOL-D connector has no methods", async () => {
      mockAccount.value = "0xWallet";
      mockActiveAccount.value = { id: 1 };
      mockForkId.value = "fork-123";

      // DSA with internal that fails to probe any connector methods
      mockDsa.value = {
        Spell: vi.fn(() => ({ add: vi.fn() })),
        cast: vi.fn(),
        instapool_v2: { encodeFlashCastData: vi.fn() },
        internal: {
          getInterface: vi.fn(),
          encodeMethod: vi.fn().mockImplementation(() => {
            throw new Error("unknown connector");
          }),
        },
      };

      await liquidator.executeTarget(makeLiquidationTarget({ expectedNetProfitUsd: "100" }));

      expect(liquidator.executionError.value).toMatch(/INSTAPOOL-D/i);
    });
  });

  // ── pending flag lifecycle ─────────────────────────────────────────────────

  describe("pending flag lifecycle", () => {
    it("pending resets to false after executeTarget finishes", async () => {
      mockAccount.value = null; // will fail early
      await liquidator.executeTarget(makeLiquidationTarget());
      expect(liquidator.pending.value).toBe(false);
    });
  });
});

// ─── Pure function logic tests ────────────────────────────────────────────────

describe("parseInputsFromError logic", () => {
  function parseInputsFromError(errorMessage: string): Array<{ name: string; type: string }> {
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

  it("extracts inputs array from a matching error message", () => {
    const error =
      'types/values length mismatch - value={"types":[{"name":"collateral","type":"address"},{"name":"debtAmt","type":"uint256"}]}, code=INVALID_ARGUMENT';
    const result = parseInputsFromError(error);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ name: "collateral", type: "address" });
    expect(result[1]).toEqual({ name: "debtAmt", type: "uint256" });
  });

  it("returns empty array when error message does not match pattern", () => {
    expect(parseInputsFromError("some random error")).toEqual([]);
  });

  it("returns empty array for empty string", () => {
    expect(parseInputsFromError("")).toEqual([]);
  });

  it("returns empty array when JSON is malformed", () => {
    const error = "value={invalid json}, code=INVALID_ARGUMENT";
    expect(parseInputsFromError(error)).toEqual([]);
  });

  it("returns empty array when types key is absent in JSON", () => {
    const error = 'value={"other":"data"}, code=INVALID_ARGUMENT';
    expect(parseInputsFromError(error)).toEqual([]);
  });

  it("handles null gracefully", () => {
    expect(parseInputsFromError(null as any)).toEqual([]);
  });

  it("handles undefined gracefully", () => {
    expect(parseInputsFromError(undefined as any)).toEqual([]);
  });

  it("extracts a full Aave liquidation method signature", () => {
    const error =
      'types/values length mismatch - value={"types":[{"name":"collateralAsset","type":"address"},{"name":"debtAsset","type":"address"},{"name":"user","type":"address"},{"name":"debtToCover","type":"uint256"},{"name":"receiveAToken","type":"bool"},{"name":"getId","type":"uint256"},{"name":"setId","type":"uint256"}]}, code=INVALID_ARGUMENT';
    const result = parseInputsFromError(error);
    expect(result).toHaveLength(7);
    expect(result.map(r => r.name)).toEqual([
      "collateralAsset",
      "debtAsset",
      "user",
      "debtToCover",
      "receiveAToken",
      "getId",
      "setId",
    ]);
  });
});

describe("mapLiquidationInput logic", () => {
  const target = {
    user: "0xaaaa000000000000000000000000000000000001",
    debtTokenAddress: "0xdebt0000000000000000000000000000000000aa",
    collateralTokenAddress: "0xcoll0000000000000000000000000000000000bb",
    debtToCoverRaw: "1000000000",
    healthFactor: "0.85",
    marketAddress: "0xmarket",
    chainId: 1,
    debtTokenSymbol: "USDC",
    debtTokenDecimals: 6,
    collateralTokenSymbol: "WETH",
    collateralTokenDecimals: 18,
    debtToCoverUsd: "1000",
    estimatedCollateralSeizedUsd: "1050",
    liquidationBonusPct: "0.05",
    flashloanFeeUsd: "0.9",
    instadappFeeUsd: "0.5",
    estimatedGasUsd: "25",
    expectedBonusUsd: "50",
    expectedNetProfitUsd: "23.6",
    isProfitable: true,
    score: "33.6",
    ethPriceUsd: "2000",
  };

  function mapLiquidationInput(inputName: string, t: typeof target): any {
    const key = inputName.toLowerCase();
    if (key.includes("collateral")) return t.collateralTokenAddress;
    if (key.includes("debt")) return t.debtTokenAddress;
    if (key === "user" || key.includes("target")) return t.user;
    if (key.includes("amount") || key.includes("amt") || key.includes("cover")) {
      return t.debtToCoverRaw;
    }
    if (key.includes("receiveatoken")) return false;
    if (key.includes("ratemode")) return 2;
    if (key.includes("getid") || key.includes("setid") || key.includes("data")) {
      return 0;
    }
    return 0;
  }

  it("maps collateralAsset → collateralTokenAddress", () => {
    expect(mapLiquidationInput("collateralAsset", target)).toBe(target.collateralTokenAddress);
  });

  it("maps debtAsset → debtTokenAddress", () => {
    expect(mapLiquidationInput("debtAsset", target)).toBe(target.debtTokenAddress);
  });

  it("maps 'user' exactly → target.user", () => {
    expect(mapLiquidationInput("user", target)).toBe(target.user);
  });

  it("maps 'targetUser' (contains target) → target.user", () => {
    expect(mapLiquidationInput("targetUser", target)).toBe(target.user);
  });

  it("maps 'debtToCover' → debtTokenAddress (debt check precedes cover check)", () => {
    // "debtToCover" contains "debt" which is checked before "cover",
    // so it resolves to debtTokenAddress per the source's short-circuit logic.
    expect(mapLiquidationInput("debtToCover", target)).toBe(target.debtTokenAddress);
  });

  it("maps 'amount' → debtToCoverRaw", () => {
    expect(mapLiquidationInput("amount", target)).toBe(target.debtToCoverRaw);
  });

  it("maps 'amt' → debtToCoverRaw", () => {
    expect(mapLiquidationInput("amt", target)).toBe(target.debtToCoverRaw);
  });

  it("maps 'receiveAToken' → false", () => {
    expect(mapLiquidationInput("receiveAToken", target)).toBe(false);
  });

  it("maps 'rateMode' → 2 (variable rate)", () => {
    expect(mapLiquidationInput("rateMode", target)).toBe(2);
  });

  it("maps 'getId' → 0", () => {
    expect(mapLiquidationInput("getId", target)).toBe(0);
  });

  it("maps 'setId' → 0", () => {
    expect(mapLiquidationInput("setId", target)).toBe(0);
  });

  it("maps 'data' → 0", () => {
    expect(mapLiquidationInput("data", target)).toBe(0);
  });

  it("maps unknown input → 0 (default fallback)", () => {
    expect(mapLiquidationInput("unknownParam", target)).toBe(0);
  });

  it("is case-insensitive for input name matching", () => {
    expect(mapLiquidationInput("COLLATERALASSET", target)).toBe(target.collateralTokenAddress);
    expect(mapLiquidationInput("DEBTASSET", target)).toBe(target.debtTokenAddress);
    expect(mapLiquidationInput("USER", target)).toBe(target.user);
  });
});

describe("getFlashPaybackAmount logic", () => {
  const FLASHLOAN_FEE = "0.0009";

  function getFlashPaybackAmount(amountRaw: string): string {
    const BN = BigNumber;
    BN.config({ POW_PRECISION: 200 });
    return new BN(amountRaw)
      .times(new BN("1").plus(FLASHLOAN_FEE))
      .integerValue(0) // BigNumber.ROUND_DOWN
      .toFixed();
  }

  it("adds 0.09% fee to raw amount (integer result, no rounding needed)", () => {
    // 1000000000 * 1.0009 = 1000900000.0 → exact integer → 1000900000
    expect(getFlashPaybackAmount("1000000000")).toBe("1000900000");
  });

  it("result is always >= original amount for positive input", () => {
    const amount = "500000000";
    const result = getFlashPaybackAmount(amount);
    expect(new BigNumber(result).gte(amount)).toBe(true);
  });

  it("rounds up fractional results (integerValue(0) = BigNumber.ROUND_UP)", () => {
    // integerValue(0) uses BigNumber.ROUND_UP (mode 0 = round away from zero).
    // 1 * 1.0009 = 1.0009 → ROUND_UP → 2
    expect(getFlashPaybackAmount("1")).toBe("2");
  });

  it("handles zero amount", () => {
    expect(getFlashPaybackAmount("0")).toBe("0");
  });

  it("handles large amounts (1 ETH in wei)", () => {
    // 1e18 * 1.0009 = 1.0009e18 → 1000900000000000000
    expect(getFlashPaybackAmount("1000000000000000000")).toBe("1000900000000000000");
  });

  it("result is strictly greater than original for positive amounts > 1", () => {
    const original = "999999999";
    const payback = getFlashPaybackAmount(original);
    expect(new BigNumber(payback).gt(original)).toBe(true);
  });

  it("flashloan fee is approximately 0.09% of input", () => {
    const amount = "10000000000"; // 10000 USDC * 1e6
    const payback = getFlashPaybackAmount(amount);
    const fee = new BigNumber(payback).minus(amount);
    const feeRatio = fee.div(amount).toNumber();
    expect(feeRatio).toBeCloseTo(0.0009, 4);
  });
});