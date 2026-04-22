import {
  computed,
  onBeforeUnmount,
  readonly,
  ref,
  useContext
} from "@nuxtjs/composition-api";
import { useWeb3 } from "@instadapp/vue-web3";
import { useBigNumber } from "~/composables/useBigNumber";
import { Network, useNetwork } from "~/composables/useNetwork";

const AAVE_V3_API_URL = "https://api.v3.aave.com/graphql";
const DEFAULT_AAVE_V3_SUBGRAPH_URL =
  "https://api.thegraph.com/subgraphs/name/aave/protocol-v3";
const ETHEREUM_CHAIN_ID = 1;
const DEFAULT_SCAN_INTERVAL_MS = 30_000;
const DEFAULT_MAX_SCANNED_USERS = 24;
const DEFAULT_GAS_UNITS = "900000";
const DEFAULT_GAS_USD_FALLBACK = "25";
const FLASHLOAN_FEE = "0.0009";
const INSTADAPP_FEE = "0.0005";

type ReserveMeta = {
  address: string;
  symbol: string;
  decimals: number;
  usdPrice: string;
  liquidationBonus: string;
  canBeCollateral: boolean;
  flashLoanEnabled: boolean;
};

type LiquidationTarget = {
  user: string;
  healthFactor: string;
  marketAddress: string;
  chainId: number;
  debtTokenAddress: string;
  debtTokenSymbol: string;
  debtTokenDecimals: number;
  collateralTokenAddress: string;
  collateralTokenSymbol: string;
  collateralTokenDecimals: number;
  debtToCoverRaw: string;
  debtToCoverUsd: string;
  estimatedCollateralSeizedUsd: string;
  liquidationBonusPct: string;
  flashloanFeeUsd: string;
  instadappFeeUsd: string;
  estimatedGasUsd: string;
  expectedBonusUsd: string;
  expectedNetProfitUsd: string;
  isProfitable: boolean;
  score: string;
  ethPriceUsd: string;
};

const targets = ref<LiquidationTarget[]>([]);
const loading = ref(false);
const scannerError = ref("");
const scannerWarnings = ref<string[]>([]);
const lastScanAt = ref<number | null>(null);
const marketAddress = ref("");
const scannerRunning = ref(false);

let scannerTimer: ReturnType<typeof setInterval> | null = null;

function normalizeAddress(address: string) {
  return String(address || "").toLowerCase();
}

function isAddress(address: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(address || ""));
}

function parseWatchlist(raw: string) {
  if (!raw) return [];

  return raw
    .split(",")
    .map(address => address.trim())
    .filter(address => isAddress(address))
    .map(normalizeAddress);
}

export function useLiquidationScanner() {
  const { $axios, $config } = useContext();
  const { library } = useWeb3();
  const { activeNetworkId } = useNetwork();
  const { toBN, gt } = useBigNumber();

  const maxScannedUsers = Number(
    $config.AAVE_V3_MAX_SCANNED_USERS || DEFAULT_MAX_SCANNED_USERS
  );
  const configuredSubgraphUrl =
    $config.AAVE_V3_SUBGRAPH_URL || DEFAULT_AAVE_V3_SUBGRAPH_URL;
  const configuredWatchlist = parseWatchlist(
    $config.AAVE_V3_LIQUIDATION_WATCHLIST || ""
  );

  const profitableTargets = computed(() =>
    targets.value.filter(target => target.isProfitable)
  );

  const topProfitableTarget = computed(() => profitableTargets.value[0] || null);

  const targetsByUser = computed((): Record<string, LiquidationTarget> => {
    return targets.value.reduce((acc: Record<string, LiquidationTarget>, target) => {
      acc[normalizeAddress(target.user)] = target;
      return acc;
    }, {});
  });

  const canRunScanner = computed(
    () => activeNetworkId.value === Network.Mainnet && !!configuredSubgraphUrl
  );

  async function fetchMainnetMarketAddress() {
    if (marketAddress.value) {
      return marketAddress.value;
    }

    const query = `
      query {
        markets(request: { chainIds: [${ETHEREUM_CHAIN_ID}] }) {
          address
          name
          chain {
            chainId
          }
        }
      }
    `;

    const response = await $axios.$post(AAVE_V3_API_URL, { query });
    const markets = response?.data?.markets || [];

    const primaryMarket =
      markets.find(market => market?.name === "AaveV3Ethereum") || markets[0];

    marketAddress.value = primaryMarket?.address || "";
    return marketAddress.value;
  }

  async function fetchReserveMeta(currentMarketAddress: string) {
    const query = `
      query($market: EvmAddress!) {
        market(request: { chainId: ${ETHEREUM_CHAIN_ID}, address: $market }) {
          reserves {
            underlyingToken {
              address
              symbol
              decimals
            }
            usdExchangeRate
            flashLoanEnabled
            supplyInfo {
              liquidationBonus {
                value
              }
              canBeCollateral
            }
          }
        }
      }
    `;

    const response = await $axios.$post(AAVE_V3_API_URL, {
      query,
      variables: { market: currentMarketAddress }
    });

    const reserves = response?.data?.market?.reserves || [];

    const reserveMap = reserves.reduce((acc, reserve) => {
      const tokenAddress = normalizeAddress(reserve?.underlyingToken?.address);
      if (!tokenAddress) {
        return acc;
      }

      acc[tokenAddress] = {
        address: reserve?.underlyingToken?.address,
        symbol: reserve?.underlyingToken?.symbol || "",
        decimals: Number(reserve?.underlyingToken?.decimals || 18),
        usdPrice: String(reserve?.usdExchangeRate || "0"),
        liquidationBonus: String(reserve?.supplyInfo?.liquidationBonus?.value || "0"),
        canBeCollateral: Boolean(reserve?.supplyInfo?.canBeCollateral),
        flashLoanEnabled: Boolean(reserve?.flashLoanEnabled)
      } as ReserveMeta;

      return acc;
    }, {} as Record<string, ReserveMeta>);

    return reserveMap;
  }

  async function fetchCandidateUsers() {
    const query = `
      query($first: Int!) {
        users(
          first: $first
          where: { healthFactor_lt: "1" }
          orderBy: healthFactor
          orderDirection: asc
        ) {
          id
          healthFactor
        }
      }
    `;

    const users = new Set<string>(configuredWatchlist);
    const warnings: string[] = [];

    try {
      const response = await $axios.$post(configuredSubgraphUrl, {
        query,
        variables: { first: Math.max(10, maxScannedUsers * 2) }
      });

      const rows = response?.data?.users || response?.users || [];
      rows.forEach(row => {
        if (isAddress(row?.id)) {
          users.add(normalizeAddress(row.id));
        }
      });
    } catch (error) {
      warnings.push(
        "Could not fetch users from Aave subgraph endpoint. Configure AAVE_V3_SUBGRAPH_URL or AAVE_V3_LIQUIDATION_WATCHLIST."
      );
    }

    scannerWarnings.value = warnings;
    return [...users].slice(0, maxScannedUsers);
  }

  async function estimateGasUsd(ethPriceUsd: string) {
    if (!library.value || !library.value.eth) {
      return DEFAULT_GAS_USD_FALLBACK;
    }

    try {
      const gasPriceWei = await library.value.eth.getGasPrice();
      const gasCostEth = toBN(gasPriceWei)
        .times(DEFAULT_GAS_UNITS)
        .div("1000000000000000000");

      return gasCostEth.times(ethPriceUsd || "0").toFixed();
    } catch (_error) {
      return DEFAULT_GAS_USD_FALLBACK;
    }
  }

  async function fetchUserTarget(
    user: string,
    currentMarketAddress: string,
    reserveMap: Record<string, ReserveMeta>,
    estimatedGasUsd: string,
    ethPriceUsd: string
  ): Promise<LiquidationTarget | null> {
    const query = `
      query($market: EvmAddress!, $user: EvmAddress!) {
        userMarketState(
          request: { market: $market, user: $user, chainId: ${ETHEREUM_CHAIN_ID} }
        ) {
          healthFactor
          totalDebtBase
        }
        userBorrows(
          request: {
            markets: [{ address: $market, chainId: ${ETHEREUM_CHAIN_ID} }]
            user: $user
            orderBy: { debt: DESC }
          }
        ) {
          currency {
            address
            symbol
            decimals
          }
          debt {
            usd
            amount {
              raw
              value
            }
          }
        }
        userSupplies(
          request: {
            markets: [{ address: $market, chainId: ${ETHEREUM_CHAIN_ID} }]
            user: $user
            collateralsOnly: true
            orderBy: { balance: DESC }
          }
        ) {
          currency {
            address
            symbol
            decimals
          }
          balance {
            usd
            amount {
              raw
              value
            }
          }
          isCollateral
          canBeCollateral
        }
      }
    `;

    const response = await $axios.$post(AAVE_V3_API_URL, {
      query,
      variables: {
        market: currentMarketAddress,
        user
      }
    });

    const marketState = response?.data?.userMarketState;
    const healthFactor = String(marketState?.healthFactor || "0");

    if (!gt("1", healthFactor)) {
      return null;
    }

    const borrows = response?.data?.userBorrows || [];
    const supplies = response?.data?.userSupplies || [];

    const debtPosition = borrows.find(borrow => {
      const tokenAddress = normalizeAddress(borrow?.currency?.address);
      const reserve = reserveMap[tokenAddress];
      return reserve && reserve.flashLoanEnabled && gt(borrow?.debt?.usd || "0", "0");
    });

    if (!debtPosition) {
      return null;
    }

    const collateralPosition = supplies.find(supply => {
      const tokenAddress = normalizeAddress(supply?.currency?.address);
      const reserve = reserveMap[tokenAddress];
      return (
        reserve &&
        reserve.canBeCollateral &&
        supply?.isCollateral &&
        gt(supply?.balance?.usd || "0", "0")
      );
    });

    if (!collateralPosition) {
      return null;
    }

    const debtTokenAddress = normalizeAddress(debtPosition?.currency?.address);
    const collateralTokenAddress = normalizeAddress(collateralPosition?.currency?.address);
    const collateralReserve = reserveMap[collateralTokenAddress];
    const debtUsd = String(debtPosition?.debt?.usd || "0");
    const debtRaw = String(debtPosition?.debt?.amount?.raw || "0");
    const totalDebtBase = String(marketState?.totalDebtBase || "0");

    // Aave allows full liquidation when HF <= 0.95 or for small total-debt positions.
    const canLiquidateAll = gt("0.95", healthFactor) || gt("2000", totalDebtBase);
    const coverRatio = canLiquidateAll ? "1" : "0.5";
    const debtToCoverUsd = toBN(debtUsd).times(coverRatio).toFixed();
    const debtToCoverRaw = toBN(debtRaw)
      .times(coverRatio)
      .integerValue(1)
      .toFixed();

    if (!gt(debtToCoverRaw, "0")) {
      return null;
    }

    const liquidationBonusPct = String(collateralReserve?.liquidationBonus || "0");
    const expectedBonusUsd = toBN(debtToCoverUsd).times(liquidationBonusPct).toFixed();
    const flashloanFeeUsd = toBN(debtToCoverUsd).times(FLASHLOAN_FEE).toFixed();
    const instadappFeeUsd = toBN(debtToCoverUsd).times(INSTADAPP_FEE).toFixed();
    const expectedNetProfitUsd = toBN(expectedBonusUsd)
      .minus(flashloanFeeUsd)
      .minus(instadappFeeUsd)
      .minus(estimatedGasUsd)
      .toFixed();

    const estimatedCollateralSeizedUsd = toBN(debtToCoverUsd)
      .times(toBN(liquidationBonusPct).plus("1"))
      .toFixed();

    return {
      user,
      healthFactor,
      marketAddress: currentMarketAddress,
      chainId: ETHEREUM_CHAIN_ID,
      debtTokenAddress,
      debtTokenSymbol: debtPosition?.currency?.symbol || "",
      debtTokenDecimals: Number(debtPosition?.currency?.decimals || 18),
      collateralTokenAddress,
      collateralTokenSymbol: collateralPosition?.currency?.symbol || "",
      collateralTokenDecimals: Number(collateralPosition?.currency?.decimals || 18),
      debtToCoverRaw,
      debtToCoverUsd,
      estimatedCollateralSeizedUsd,
      liquidationBonusPct,
      flashloanFeeUsd,
      instadappFeeUsd,
      estimatedGasUsd,
      expectedBonusUsd,
      expectedNetProfitUsd,
      isProfitable: gt(expectedNetProfitUsd, "0"),
      score: toBN(expectedNetProfitUsd).plus(toBN(debtToCoverUsd).div("100")).toFixed(),
      ethPriceUsd
    };
  }

  async function refreshTargets() {
    if (loading.value || activeNetworkId.value !== Network.Mainnet) {
      return;
    }

    loading.value = true;
    scannerError.value = "";

    try {
      const currentMarketAddress = await fetchMainnetMarketAddress();
      if (!currentMarketAddress) {
        throw new Error("Aave market address is unavailable.");
      }

      const reserveMap = await fetchReserveMeta(currentMarketAddress);
      const wethReserve =
        reserveMap[normalizeAddress("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2")] ||
        (Object.values(reserveMap) as ReserveMeta[]).find(
          reserve => reserve.symbol === "WETH"
        );
      const ethPriceUsd = wethReserve?.usdPrice || "0";
      const gasUsd = await estimateGasUsd(ethPriceUsd);

      const users = await fetchCandidateUsers();
      const nextTargets: LiquidationTarget[] = [];

      for (const user of users) {
        try {
          const target = await fetchUserTarget(
            user,
            currentMarketAddress,
            reserveMap,
            gasUsd,
            ethPriceUsd
          );

          if (target) {
            nextTargets.push(target);
          }
        } catch (_error) {}
      }

      nextTargets.sort((a, b) => {
        if (a.isProfitable !== b.isProfitable) {
          return a.isProfitable ? -1 : 1;
        }

        if (gt(b.score, a.score)) return 1;
        if (gt(a.score, b.score)) return -1;
        return 0;
      });

      targets.value = nextTargets;
      lastScanAt.value = Date.now();
    } catch (error) {
      targets.value = [];
      scannerError.value =
        error?.message || "Liquidation scanner failed to refresh.";
    }

    loading.value = false;
  }

  function startScanner(intervalMs = DEFAULT_SCAN_INTERVAL_MS) {
    if (scannerTimer || scannerRunning.value) {
      return;
    }

    if (!canRunScanner.value) {
      scannerError.value =
        "Scanner is available only on Mainnet. Switch network to begin scanning.";
      return;
    }

    scannerRunning.value = true;
    refreshTargets();

    scannerTimer = setInterval(() => {
      refreshTargets();
    }, intervalMs);
  }

  function stopScanner() {
    if (scannerTimer) {
      clearInterval(scannerTimer);
      scannerTimer = null;
    }

    scannerRunning.value = false;
  }

  function getTargetByUser(user: string) {
    return targetsByUser.value[normalizeAddress(user)] || null;
  }

  onBeforeUnmount(() => {
    stopScanner();
  });

  return {
    loading: readonly(loading),
    targets: readonly(targets),
    profitableTargets,
    topProfitableTarget,
    scannerError: readonly(scannerError),
    scannerWarnings: readonly(scannerWarnings),
    lastScanAt: readonly(lastScanAt),
    scannerRunning: readonly(scannerRunning),
    canRunScanner,
    refreshTargets,
    startScanner,
    stopScanner,
    getTargetByUser
  };
}

export type { LiquidationTarget };
