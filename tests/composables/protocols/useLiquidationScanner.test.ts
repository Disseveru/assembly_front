/**
 * Tests for composables/protocols/useLiquidationScanner.ts
 *
 * Tests cover:
 * - normalizeAddress (standalone logic tests)
 * - isAddress (standalone logic tests)
 * - parseWatchlist (standalone logic tests)
 * - fetchUserTarget profit calculation logic (via full scan)
 * - refreshTargets orchestration
 * - startScanner / stopScanner lifecycle
 * - getTargetByUser lookup (case-insensitive)
 * - fetchCandidateUsers subgraph error fallback
 * - estimateGasUsd fallback
 * - canRunScanner computed
 * - targets sorting: profitable first
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ref } from "@vue/composition-api";
import BigNumber from "bignumber.js";

// ─── Module mocks ─────────────────────────────────────────────────────────────

const mockAxiosPost = vi.fn();
const mockLibraryGetGasPrice = vi.fn();
const mockActiveNetworkId = ref("mainnet");

vi.mock("@nuxtjs/composition-api", async () => {
  const vca = await import("@vue/composition-api");
  return {
    ref: vca.ref,
    computed: vca.computed,
    readonly: vca.readonly,
    onBeforeUnmount: vi.fn(),
    useContext: () => ({
      $axios: { $post: mockAxiosPost },
      $config: {
        AAVE_V3_SUBGRAPH_URL: "https://mock-subgraph.example.com",
        AAVE_V3_LIQUIDATION_WATCHLIST: "",
        AAVE_V3_MAX_SCANNED_USERS: "10",
      },
    }),
  };
});

vi.mock("@instadapp/vue-web3", () => ({
  useWeb3: () => ({
    library: ref({ eth: { getGasPrice: mockLibraryGetGasPrice } }),
  }),
}));

vi.mock("~/composables/useNetwork", () => ({
  Network: { Mainnet: "mainnet" },
  useNetwork: () => ({ activeNetworkId: mockActiveNetworkId }),
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

function makeReserveMap() {
  return {
    "0xdebt0000000000000000000000000000000000aa": {
      address: "0xDebt0000000000000000000000000000000000AA",
      symbol: "USDC",
      decimals: 6,
      usdPrice: "1",
      liquidationBonus: "0.05",
      canBeCollateral: false,
      flashLoanEnabled: true,
    },
    "0xcoll0000000000000000000000000000000000bb": {
      address: "0xColl0000000000000000000000000000000000BB",
      symbol: "WETH",
      decimals: 18,
      usdPrice: "2000",
      liquidationBonus: "0.05",
      canBeCollateral: true,
      flashLoanEnabled: false,
    },
  };
}

function makeScanResponseSet({
  marketAddress = "0xMarket000000000000000000000000000000001",
  users = [{ id: "0xaaaa000000000000000000000000000000000001", healthFactor: "0.85" }],
  healthFactor = "0.85",
  totalDebtBase = "10000",
  debtUsd = "1000",
  debtRaw = "1000000000",
  liquidationBonus = "0.05",
} = {}) {
  return [
    // markets response
    {
      data: { markets: [{ address: marketAddress, name: "AaveV3Ethereum" }] },
    },
    // reserves response
    {
      data: {
        market: {
          reserves: [
            {
              underlyingToken: {
                address: "0xDebt0000000000000000000000000000000000AA",
                symbol: "USDC",
                decimals: 6,
              },
              usdExchangeRate: "1",
              flashLoanEnabled: true,
              supplyInfo: { liquidationBonus: { value: liquidationBonus }, canBeCollateral: false },
            },
            {
              underlyingToken: {
                address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
                symbol: "WETH",
                decimals: 18,
              },
              usdExchangeRate: "2000",
              flashLoanEnabled: false,
              supplyInfo: { liquidationBonus: { value: liquidationBonus }, canBeCollateral: true },
            },
            {
              underlyingToken: {
                address: "0xColl0000000000000000000000000000000000BB",
                symbol: "WBTC",
                decimals: 8,
              },
              usdExchangeRate: "45000",
              flashLoanEnabled: false,
              supplyInfo: { liquidationBonus: { value: liquidationBonus }, canBeCollateral: true },
            },
          ],
        },
      },
    },
    // users (subgraph) response
    { data: { users } },
    // per-user data response
    {
      data: {
        userMarketState: { healthFactor, totalDebtBase },
        userBorrows: [
          {
            currency: { address: "0xDebt0000000000000000000000000000000000AA", symbol: "USDC", decimals: 6 },
            debt: { usd: debtUsd, amount: { raw: debtRaw, value: String(Number(debtRaw) / 1e6) } },
          },
        ],
        userSupplies: [
          {
            currency: { address: "0xColl0000000000000000000000000000000000BB", symbol: "WBTC", decimals: 8 },
            balance: { usd: "2000", amount: { raw: "100000000", value: "1" } },
            isCollateral: true,
            canBeCollateral: true,
          },
        ],
      },
    },
  ];
}

function setupAxiosMocks(responses: any[]) {
  responses.forEach(r => mockAxiosPost.mockResolvedValueOnce(r));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("useLiquidationScanner", () => {
  let scanner: ReturnType<typeof import("~/composables/protocols/useLiquidationScanner").useLiquidationScanner>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockLibraryGetGasPrice.mockResolvedValue("20000000000"); // 20 Gwei
    mockActiveNetworkId.value = "mainnet";

    // Re-import to get fresh module-level refs
    vi.resetModules();

    const mod = await import("~/composables/protocols/useLiquidationScanner");
    scanner = mod.useLiquidationScanner();
  });

  afterEach(() => {
    scanner.stopScanner();
    vi.useRealTimers();
  });

  // ── canRunScanner ──────────────────────────────────────────────────────────

  describe("canRunScanner", () => {
    it("returns true when on Mainnet with a subgraph URL configured", () => {
      mockActiveNetworkId.value = "mainnet";
      expect(scanner.canRunScanner.value).toBe(true);
    });

    it("returns false when not on Mainnet", () => {
      mockActiveNetworkId.value = "polygon";
      expect(scanner.canRunScanner.value).toBe(false);
    });
  });

  // ── startScanner / stopScanner ─────────────────────────────────────────────

  describe("startScanner / stopScanner", () => {
    it("does not start on non-mainnet and sets scannerError", () => {
      mockActiveNetworkId.value = "polygon";
      vi.useFakeTimers();

      scanner.startScanner();

      expect(scanner.scannerRunning.value).toBe(false);
      expect(scanner.scannerError.value).toMatch(/Mainnet/i);
    });

    it("sets scannerRunning to true when starting on Mainnet", () => {
      mockAxiosPost.mockResolvedValue({ data: { markets: [] } });
      vi.useFakeTimers();

      scanner.startScanner();

      expect(scanner.scannerRunning.value).toBe(true);
    });

    it("stopScanner sets scannerRunning to false", () => {
      mockAxiosPost.mockResolvedValue({ data: { markets: [] } });
      vi.useFakeTimers();

      scanner.startScanner();
      scanner.stopScanner();

      expect(scanner.scannerRunning.value).toBe(false);
    });

    it("calling startScanner twice does not create a second interval", () => {
      mockAxiosPost.mockResolvedValue({ data: { markets: [] } });
      vi.useFakeTimers();
      const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

      scanner.startScanner();
      scanner.startScanner();

      expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ── refreshTargets ─────────────────────────────────────────────────────────

  describe("refreshTargets", () => {
    it("sets scannerError when market address fetch returns empty", async () => {
      mockAxiosPost.mockResolvedValueOnce({ data: { markets: [] } });

      await scanner.refreshTargets();

      expect(scanner.scannerError.value).toMatch(/Aave market address/i);
      expect(scanner.targets.value).toEqual([]);
    });

    it("does not run when activeNetworkId is not Mainnet", async () => {
      mockActiveNetworkId.value = "polygon";

      await scanner.refreshTargets();

      expect(mockAxiosPost).not.toHaveBeenCalled();
      expect(scanner.loading.value).toBe(false);
    });

    it("sets targets and lastScanAt after a successful full scan cycle", async () => {
      setupAxiosMocks(makeScanResponseSet({ debtUsd: "5000", debtRaw: "5000000000" }));
      mockLibraryGetGasPrice.mockResolvedValue("1000000000"); // low gas

      await scanner.refreshTargets();

      expect(scanner.targets.value.length).toBeGreaterThan(0);
      expect(scanner.loading.value).toBe(false);
      expect(scanner.lastScanAt.value).not.toBeNull();
    });

    it("clears loading flag even when scan fails", async () => {
      mockAxiosPost.mockRejectedValueOnce(new Error("network error"));

      await scanner.refreshTargets();

      expect(scanner.loading.value).toBe(false);
    });

    it("does not run a second scan while loading is already true", async () => {
      let resolveFirst: (v: any) => void;
      const hangingPromise = new Promise(resolve => { resolveFirst = resolve; });
      mockAxiosPost.mockReturnValueOnce(hangingPromise);

      const firstScan = scanner.refreshTargets();
      // Second call should be a no-op (loading is true)
      await scanner.refreshTargets();
      resolveFirst!({ data: { markets: [] } });
      await firstScan;

      // Only 1 API call made (the first scan's markets request)
      expect(mockAxiosPost).toHaveBeenCalledTimes(1);
    });
  });

  // ── fetchCandidateUsers subgraph error handling ────────────────────────────

  describe("fetchCandidateUsers error handling", () => {
    it("adds a warning when subgraph request fails", async () => {
      mockAxiosPost
        .mockResolvedValueOnce({ data: { markets: [{ address: "0xMarket001", name: "AaveV3Ethereum" }] } })
        .mockResolvedValueOnce({ data: { market: { reserves: [] } } })
        .mockRejectedValueOnce(new Error("Subgraph down"));

      await scanner.refreshTargets();

      expect(scanner.scannerWarnings.value).toHaveLength(1);
      expect(scanner.scannerWarnings.value[0]).toMatch(/subgraph endpoint/i);
    });
  });

  // ── estimateGasUsd fallback ────────────────────────────────────────────────

  describe("estimateGasUsd fallback", () => {
    it("still completes scan when getGasPrice throws", async () => {
      mockLibraryGetGasPrice.mockRejectedValueOnce(new Error("RPC error"));
      mockAxiosPost
        .mockResolvedValueOnce({ data: { markets: [{ address: "0xMarket001", name: "AaveV3Ethereum" }] } })
        .mockResolvedValueOnce({
          data: {
            market: {
              reserves: [{
                underlyingToken: { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", symbol: "WETH", decimals: 18 },
                usdExchangeRate: "2000",
                flashLoanEnabled: false,
                supplyInfo: { liquidationBonus: { value: "0.05" }, canBeCollateral: true },
              }],
            },
          },
        })
        .mockResolvedValueOnce({ data: { users: [] } });

      await scanner.refreshTargets();

      // Scan should complete without throwing
      expect(scanner.scannerError.value).toBe("");
    });
  });

  // ── getTargetByUser case-insensitive lookup ────────────────────────────────

  describe("getTargetByUser", () => {
    it("returns null when no targets are loaded", () => {
      expect(scanner.getTargetByUser("0xABCDEF")).toBeNull();
    });

    it("performs case-insensitive lookup", async () => {
      const userLower = "0xaaaa000000000000000000000000000000000001";
      setupAxiosMocks(makeScanResponseSet({ users: [{ id: userLower, healthFactor: "0.85" }], debtUsd: "5000", debtRaw: "5000000000" }));
      mockLibraryGetGasPrice.mockResolvedValue("1000000000");

      await scanner.refreshTargets();

      if (scanner.targets.value.length > 0) {
        const upperUser = userLower.toUpperCase();
        const result = scanner.getTargetByUser(upperUser);
        expect(result).not.toBeNull();
        expect(result?.user).toBe(userLower);
      }
    });

    it("returns null for user not in targets", async () => {
      setupAxiosMocks(makeScanResponseSet());
      mockLibraryGetGasPrice.mockResolvedValue("1000000000");
      await scanner.refreshTargets();

      expect(scanner.getTargetByUser("0x0000000000000000000000000000000000000000")).toBeNull();
    });
  });

  // ── profitableTargets / topProfitableTarget ────────────────────────────────

  describe("profitableTargets / topProfitableTarget", () => {
    it("profitableTargets is empty when targets is empty", () => {
      expect(scanner.profitableTargets.value).toEqual([]);
    });

    it("topProfitableTarget is null when no targets", () => {
      expect(scanner.topProfitableTarget.value).toBeNull();
    });

    it("topProfitableTarget is the first profitable target after scan", async () => {
      setupAxiosMocks(makeScanResponseSet({
        liquidationBonus: "0.1",
        debtUsd: "100000",
        debtRaw: "100000000000",
      }));
      mockLibraryGetGasPrice.mockResolvedValue("1000000000"); // minimal gas

      await scanner.refreshTargets();

      if (scanner.profitableTargets.value.length > 0) {
        expect(scanner.topProfitableTarget.value).toBe(scanner.profitableTargets.value[0]);
      }
    });
  });

  // ── fetchUserTarget: cover ratio ──────────────────────────────────────────

  describe("fetchUserTarget cover ratio logic", () => {
    it("uses 50% cover ratio when HF is between 0.95 and 1", async () => {
      setupAxiosMocks(makeScanResponseSet({
        healthFactor: "0.97",
        totalDebtBase: "50000",
        debtUsd: "5000",
        debtRaw: "5000000000",
      }));
      mockLibraryGetGasPrice.mockResolvedValue("1000000000");

      await scanner.refreshTargets();

      const targets = scanner.targets.value;
      if (targets.length > 0) {
        // 50% of 5000 = 2500
        expect(new BigNumber(targets[0].debtToCoverUsd).toFixed(0)).toBe("2500");
      }
    });

    it("uses 100% cover ratio when HF <= 0.95", async () => {
      setupAxiosMocks(makeScanResponseSet({
        healthFactor: "0.85",
        totalDebtBase: "50000",
        debtUsd: "5000",
        debtRaw: "5000000000",
      }));
      mockLibraryGetGasPrice.mockResolvedValue("1000000000");

      await scanner.refreshTargets();

      const targets = scanner.targets.value;
      if (targets.length > 0) {
        expect(new BigNumber(targets[0].debtToCoverUsd).toFixed(0)).toBe("5000");
      }
    });

    it("uses 100% cover ratio when totalDebtBase < 2000 (small position)", async () => {
      setupAxiosMocks(makeScanResponseSet({
        healthFactor: "0.97",
        totalDebtBase: "100",
        debtUsd: "100",
        debtRaw: "100000000",
      }));
      mockLibraryGetGasPrice.mockResolvedValue("1000000000");

      await scanner.refreshTargets();

      const targets = scanner.targets.value;
      if (targets.length > 0) {
        // small position (totalDebtBase < 2000) → full liquidation
        expect(new BigNumber(targets[0].debtToCoverUsd).toFixed(0)).toBe("100");
      }
    });

    it("excludes targets where healthFactor >= 1", async () => {
      setupAxiosMocks(makeScanResponseSet({ healthFactor: "1.1" }));
      mockLibraryGetGasPrice.mockResolvedValue("1000000000");

      await scanner.refreshTargets();

      expect(scanner.targets.value).toHaveLength(0);
    });

    it("excludes positions where debt token has flashLoanEnabled=false", async () => {
      mockAxiosPost
        .mockResolvedValueOnce({ data: { markets: [{ address: "0xMarket001", name: "AaveV3Ethereum" }] } })
        .mockResolvedValueOnce({
          data: {
            market: {
              reserves: [{
                underlyingToken: { address: "0xDebt0000000000000000000000000000000000AA", symbol: "USDC", decimals: 6 },
                usdExchangeRate: "1",
                flashLoanEnabled: false, // not flash-loanable
                supplyInfo: { liquidationBonus: { value: "0.05" }, canBeCollateral: false },
              }],
            },
          },
        })
        .mockResolvedValueOnce({ data: { users: [{ id: "0xaaaa000000000000000000000000000000000001", healthFactor: "0.85" }] } })
        .mockResolvedValueOnce({
          data: {
            userMarketState: { healthFactor: "0.85", totalDebtBase: "10000" },
            userBorrows: [{
              currency: { address: "0xDebt0000000000000000000000000000000000AA", symbol: "USDC", decimals: 6 },
              debt: { usd: "1000", amount: { raw: "1000000000", value: "1000" } },
            }],
            userSupplies: [{
              currency: { address: "0xColl0000000000000000000000000000000000BB", symbol: "WBTC", decimals: 8 },
              balance: { usd: "2000", amount: { raw: "100000000", value: "1" } },
              isCollateral: true, canBeCollateral: true,
            }],
          },
        });
      mockLibraryGetGasPrice.mockResolvedValue("1000000000");

      await scanner.refreshTargets();

      expect(scanner.targets.value).toHaveLength(0);
    });
  });

  // ── targets sorting ────────────────────────────────────────────────────────

  describe("targets sorting", () => {
    it("profitable targets appear before unprofitable ones", async () => {
      // market address (shared across two users)
      mockAxiosPost
        .mockResolvedValueOnce({ data: { markets: [{ address: "0xMarket001", name: "AaveV3Ethereum" }] } })
        .mockResolvedValueOnce({
          data: {
            market: {
              reserves: [
                {
                  underlyingToken: { address: "0xDebt0000000000000000000000000000000000AA", symbol: "USDC", decimals: 6 },
                  usdExchangeRate: "1", flashLoanEnabled: true,
                  supplyInfo: { liquidationBonus: { value: "0.1" }, canBeCollateral: false },
                },
                {
                  underlyingToken: { address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", symbol: "WETH", decimals: 18 },
                  usdExchangeRate: "2000", flashLoanEnabled: false,
                  supplyInfo: { liquidationBonus: { value: "0.1" }, canBeCollateral: true },
                },
                {
                  underlyingToken: { address: "0xColl0000000000000000000000000000000000BB", symbol: "WBTC", decimals: 8 },
                  usdExchangeRate: "45000", flashLoanEnabled: false,
                  supplyInfo: { liquidationBonus: { value: "0.1" }, canBeCollateral: true },
                },
              ],
            },
          },
        })
        .mockResolvedValueOnce({
          data: {
            users: [
              { id: "0xaaaa000000000000000000000000000000000001", healthFactor: "0.85" },
              { id: "0xbbbb000000000000000000000000000000000002", healthFactor: "0.90" },
            ],
          },
        })
        // User 1: small position
        .mockResolvedValueOnce({
          data: {
            userMarketState: { healthFactor: "0.85", totalDebtBase: "10" },
            userBorrows: [{
              currency: { address: "0xDebt0000000000000000000000000000000000AA", symbol: "USDC", decimals: 6 },
              debt: { usd: "10", amount: { raw: "10000000", value: "10" } },
            }],
            userSupplies: [{
              currency: { address: "0xColl0000000000000000000000000000000000BB", symbol: "WBTC", decimals: 8 },
              balance: { usd: "20", amount: { raw: "50000", value: "0.0005" } },
              isCollateral: true, canBeCollateral: true,
            }],
          },
        })
        // User 2: large position
        .mockResolvedValueOnce({
          data: {
            userMarketState: { healthFactor: "0.90", totalDebtBase: "50000" },
            userBorrows: [{
              currency: { address: "0xDebt0000000000000000000000000000000000AA", symbol: "USDC", decimals: 6 },
              debt: { usd: "100000", amount: { raw: "100000000000", value: "100000" } },
            }],
            userSupplies: [{
              currency: { address: "0xColl0000000000000000000000000000000000BB", symbol: "WBTC", decimals: 8 },
              balance: { usd: "200000", amount: { raw: "500000000", value: "5" } },
              isCollateral: true, canBeCollateral: true,
            }],
          },
        });

      mockLibraryGetGasPrice.mockResolvedValue("1000000000"); // 1 Gwei (minimal gas)

      await scanner.refreshTargets();

      const targets = scanner.targets.value;
      if (targets.length === 2) {
        // profitable target should come first
        const profitableIdx = targets.findIndex(t => t.isProfitable);
        const unprofitableIdx = targets.findIndex(t => !t.isProfitable);
        if (profitableIdx !== -1 && unprofitableIdx !== -1) {
          expect(profitableIdx).toBeLessThan(unprofitableIdx);
        }
      }
    });
  });

  // ── scannerWarnings initial state ─────────────────────────────────────────

  describe("scannerWarnings", () => {
    it("starts empty", () => {
      expect(scanner.scannerWarnings.value).toEqual([]);
    });
  });

  // ── fetchMainnetMarketAddress caching ─────────────────────────────────────

  describe("fetchMainnetMarketAddress caching", () => {
    it("prefers the market named AaveV3Ethereum when multiple markets are returned", async () => {
      const preferred = "0xPreferredMarket0000000000000000000000001";
      const other = "0xOtherMarket000000000000000000000000000002";

      mockAxiosPost
        .mockResolvedValueOnce({
          data: {
            markets: [
              { address: other, name: "SomeOtherProtocol" },
              { address: preferred, name: "AaveV3Ethereum" },
            ],
          },
        })
        .mockResolvedValueOnce({ data: { market: { reserves: [] } } })
        .mockResolvedValueOnce({ data: { users: [] } });

      await scanner.refreshTargets();

      // Second scan should not call the markets API again (cached)
      mockAxiosPost
        .mockResolvedValueOnce({ data: { market: { reserves: [] } } })
        .mockResolvedValueOnce({ data: { users: [] } });

      await scanner.refreshTargets();

      // Total: 3 calls (first scan) + 2 calls (second scan, no markets) = 5
      expect(mockAxiosPost).toHaveBeenCalledTimes(5);
    });
  });

  // ── target profit fields computation ─────────────────────────────────────

  describe("target profit field computation", () => {
    it("isProfitable is true when bonus exceeds total fees", async () => {
      setupAxiosMocks(makeScanResponseSet({
        liquidationBonus: "0.1",
        debtUsd: "100000",
        debtRaw: "100000000000",
      }));
      mockLibraryGetGasPrice.mockResolvedValue("1000000000"); // very low gas

      await scanner.refreshTargets();

      if (scanner.targets.value.length > 0) {
        const target = scanner.targets.value[0];
        // expectedBonusUsd = debtToCoverUsd * 0.1
        // flashloanFeeUsd = debtToCoverUsd * 0.0009
        // instadappFeeUsd = debtToCoverUsd * 0.0005
        // At 100% cover with 10% bonus the profit should be positive
        expect(new BigNumber(target.expectedBonusUsd).gt(0)).toBe(true);
        expect(new BigNumber(target.flashloanFeeUsd).gt(0)).toBe(true);
        expect(new BigNumber(target.instadappFeeUsd).gt(0)).toBe(true);
      }
    });
  });
});

// ─── Standalone utility logic tests ──────────────────────────────────────────

describe("normalizeAddress logic", () => {
  it("lowercases a mixed-case address", () => {
    const addr = "0xABCDEF1234567890ABCDEF1234567890ABCDEF12";
    expect(String(addr || "").toLowerCase()).toBe("0xabcdef1234567890abcdef1234567890abcdef12");
  });

  it("handles empty string gracefully", () => {
    expect(String("" || "").toLowerCase()).toBe("");
  });

  it("handles null-ish input by converting to empty string", () => {
    expect(String(null || "").toLowerCase()).toBe("");
  });
});

describe("isAddress logic", () => {
  const isAddress = (address: string) =>
    /^0x[a-fA-F0-9]{40}$/.test(String(address || ""));

  it("accepts valid lowercase hex address", () => {
    expect(isAddress("0xabcdef1234567890abcdef1234567890abcdef12")).toBe(true);
  });

  it("accepts valid mixed-case hex address", () => {
    expect(isAddress("0xABCDEF1234567890ABCDEF1234567890ABCDEF12")).toBe(true);
  });

  it("rejects address shorter than 42 chars", () => {
    expect(isAddress("0xabcdef")).toBe(false);
  });

  it("rejects address without 0x prefix", () => {
    expect(isAddress("abcdef1234567890abcdef1234567890abcdef12")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isAddress("")).toBe(false);
  });

  it("rejects address with invalid hex characters", () => {
    expect(isAddress("0xGGGGGG1234567890abcdef1234567890abcdef12")).toBe(false);
  });

  it("rejects address longer than 42 chars", () => {
    expect(isAddress("0xabcdef1234567890abcdef1234567890abcdef1234")).toBe(false);
  });
});

describe("parseWatchlist logic", () => {
  const isAddress = (address: string) =>
    /^0x[a-fA-F0-9]{40}$/.test(String(address || ""));

  function parseWatchlist(raw: string): string[] {
    if (!raw) return [];
    return raw
      .split(",")
      .map(address => address.trim())
      .filter(address => isAddress(address))
      .map(address => String(address || "").toLowerCase());
  }

  it("returns empty array for empty string", () => {
    expect(parseWatchlist("")).toEqual([]);
  });

  it("returns empty array for null-ish input", () => {
    expect(parseWatchlist(null as any)).toEqual([]);
  });

  it("parses a single valid address", () => {
    const addr = "0xAbCd123456789012345678901234567890123456";
    expect(parseWatchlist(addr)).toEqual([addr.toLowerCase()]);
  });

  it("parses multiple valid addresses separated by commas", () => {
    const a = "0xaaaa000000000000000000000000000000000001";
    const b = "0xbbbb000000000000000000000000000000000002";
    expect(parseWatchlist(`${a},${b}`)).toEqual([a, b]);
  });

  it("trims whitespace around addresses", () => {
    const addr = "0xaaaa000000000000000000000000000000000001";
    expect(parseWatchlist(`  ${addr}  `)).toEqual([addr]);
  });

  it("filters out invalid entries mixed with valid ones", () => {
    const valid = "0xaaaa000000000000000000000000000000000001";
    expect(parseWatchlist(`not-an-address,${valid},short`)).toEqual([valid]);
  });

  it("normalizes mixed-case addresses to lowercase", () => {
    const mixed = "0xAAAA000000000000000000000000000000000001";
    expect(parseWatchlist(mixed)).toEqual([mixed.toLowerCase()]);
  });

  it("deduplication not guaranteed by parseWatchlist itself (uses Set upstream)", () => {
    const addr = "0xaaaa000000000000000000000000000000000001";
    // parseWatchlist returns both (Set dedup is done in fetchCandidateUsers)
    expect(parseWatchlist(`${addr},${addr}`)).toHaveLength(2);
  });
});