import { ref, readonly, watch } from "@nuxtjs/composition-api";
import { useWeb3 } from "@instadapp/vue-web3";
import { useBigNumber } from "~/composables/useBigNumber";
import { useDSA } from "~/composables/useDSA";
import { useNetwork } from "~/composables/useNetwork";
import { useNotification } from "~/composables/useNotification";
import { useTenderly } from "~/composables/useTenderly";
import type { LiquidationTarget } from "~/composables/protocols/useLiquidationScanner";

const FLASHLOAN_ROUTE_DEFAULT = 0;
const FLASHLOAN_FEE = "0.0009";

const pending = ref(false);
const executionError = ref("");
const lastExecutedAt = ref<number | null>(null);
const connectorMethodCache = new Map<string, string[]>();

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

function clearConnectorMethodCache() {
  connectorMethodCache.clear();
}

export function useFlashLiquidator() {
  const { account } = useWeb3();
  const { dsa, activeAccount } = useDSA();
  const { activeNetworkId } = useNetwork();
  const { forkId } = useTenderly();
  const { toBN, gt } = useBigNumber();
  const { showPendingTransaction, showConfirmedTransaction, showWarning } =
    useNotification();

  watch(
    () => [
      activeNetworkId.value,
      String(account.value || "").toLowerCase(),
      String(activeAccount.value || "").toLowerCase(),
      String((dsa.value as any)?.address || "").toLowerCase()
    ],
    () => {
      clearConnectorMethodCache();
    },
    { immediate: true }
  );

  function getConnectorMethods(connector: string) {
    if (connectorMethodCache.has(connector)) {
      return connectorMethodCache.get(connector) || [];
    }

    if (!dsa.value) {
      return [];
    }

    const internal = (dsa.value as any).internal;
    const originalGetInterface = internal?.getInterface;
    let capturedAbi = null;

    if (!originalGetInterface) {
      return [];
    }

    const probeMethods = ["name", "deposit", "borrow", "flashBorrowAndCast", "castAny"];

    for (const probeMethod of probeMethods) {
      try {
        internal.getInterface = (abi, method) => {
          capturedAbi = abi;
          return originalGetInterface(abi, method);
        };
        internal.encodeMethod({ connector, method: probeMethod, args: [] }, 2);
      } catch (_error) {}

      if (capturedAbi) {
        break;
      }
    }

    internal.getInterface = originalGetInterface;

    const methods = (
      capturedAbi
        ? [
            ...new Set(
              capturedAbi
                .filter(item => item.type === "function")
                .map(item => String(item.name))
            )
          ]
        : []
    ) as string[];

    if (methods.length) {
      connectorMethodCache.set(connector, methods);
    }

    return methods;
  }

  function getMethodInputs(connector: string, method: string): MethodInput[] {
    if (!dsa.value) {
      return [];
    }

    if (!getConnectorMethods(connector).includes(method)) {
      return [];
    }

    try {
      // `internal` is not typed in app code, but is available on dsa-connect runtime.
      (dsa.value as any).internal.encodeMethod({ connector, method, args: [] }, 2);
      return [];
    } catch (error) {
      const message = String(error?.message || "");
      if (message.includes("types/values length mismatch")) {
        return parseInputsFromError(message);
      }

      return [];
    }
  }

  function hasMethod(connector: string, method: string) {
    return getMethodInputs(connector, method).length > 0;
  }

  function mapLiquidationInput(inputName: string, target: LiquidationTarget) {
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

  function getFlashPaybackAmount(amountRaw: string) {
    return toBN(amountRaw)
      .times(toBN("1").plus(FLASHLOAN_FEE))
      .integerValue(0)
      .toFixed();
  }

  async function buildExecutionSpells(target: LiquidationTarget) {
    if (!dsa.value) {
      throw new Error("DSA is unavailable.");
    }

    if (!hasMethod("INSTAPOOL-D", "flashBorrowAndCast")) {
      throw new Error(
        "INSTAPOOL-D.flashBorrowAndCast is unavailable on the current connector set."
      );
    }

    if (!hasMethod("INSTAPOOL-D", "flashPayback")) {
      throw new Error(
        "INSTAPOOL-D.flashPayback is unavailable on the current connector set."
      );
    }

    let liquidationMethod = "liquidate";
    let liquidationInputs = getMethodInputs("AAVE-V3-A", liquidationMethod);

    if (!liquidationInputs.length) {
      liquidationMethod = "liquidationCall";
      liquidationInputs = getMethodInputs("AAVE-V3-A", liquidationMethod);
    }

    if (!liquidationInputs.length) {
      throw new Error(
        "AAVE-V3-A liquidation method is unavailable in installed dsa-connect connectors. Scanner and profitability checks are active; execution is blocked until this connector method is available."
      );
    }

    const liquidationArgs = liquidationInputs.map(input =>
      mapLiquidationInput(input.name || "", target)
    );
    const paybackAmount = getFlashPaybackAmount(target.debtToCoverRaw);

    const flashInnerSpells = dsa.value.Spell();
    flashInnerSpells.add({
      connector: "AAVE-V3-A",
      method: liquidationMethod,
      args: liquidationArgs
    });
    flashInnerSpells.add({
      connector: "INSTAPOOL-D",
      method: "flashPayback",
      args: [target.debtTokenAddress, paybackAmount, 0, 0]
    });

    const flashData = (dsa.value as any).instapool_v2.encodeFlashCastData(
      flashInnerSpells
    );

    const wrappedSpells = dsa.value.Spell();
    wrappedSpells.add({
      connector: "INSTAPOOL-D",
      method: "flashBorrowAndCast",
      args: [
        target.debtTokenAddress,
        target.debtToCoverRaw,
        FLASHLOAN_ROUTE_DEFAULT,
        flashData,
        "0x"
      ]
    });

    return wrappedSpells;
  }

  async function executeTarget(target: LiquidationTarget, auto = false) {
    if (pending.value) {
      return;
    }

    pending.value = true;
    executionError.value = "";

    try {
      if (!activeAccount.value || !account.value) {
        throw new Error("Connect wallet and select a Smart Account first.");
      }

      if (!target) {
        throw new Error("No liquidation target selected.");
      }

      if (!gt(target.expectedNetProfitUsd, "0")) {
        throw new Error("Target is not profitable after fees and gas estimate.");
      }

      if (!forkId.value) {
        throw new Error(
          "Simulation mode is required. Enable Tenderly simulation before executing."
        );
      }

      const spells = await buildExecutionSpells(target);
      const txHash = await (dsa.value as any).cast({
        spells,
        from: account.value,
        onReceipt: receipt => {
          showConfirmedTransaction(receipt.transactionHash);
        }
      });

      showPendingTransaction(txHash);
      lastExecutedAt.value = Date.now();
    } catch (error) {
      executionError.value = error?.message || "Execution failed.";

      if (!auto) {
        showWarning(executionError.value);
      }
    }

    pending.value = false;
  }

  return {
    pending: readonly(pending),
    executionError: readonly(executionError),
    lastExecutedAt: readonly(lastExecutedAt),
    executeTarget,
    buildExecutionSpells,
    clearConnectorMethodCache
  };
}
