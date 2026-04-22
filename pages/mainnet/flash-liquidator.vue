<template>
  <div>
    <div>
      <nuxt-link
        to="/"
        class="text-[#C0C5D7] text-lg font-semibold flex items-center"
      >
        <BackIcon class="w-4 h-4 mr-3" />
        Apps
      </nuxt-link>
    </div>

    <div class="mt-10 flex items-center justify-between">
      <div class="flex items-center">
        <div
          style="background: radial-gradient(42.15% 42.15% at 48.94% 48.94%, #D6DAE0 75.67%, #F0F3F9 100%), #C4C4C4;"
          class="w-16 h-16 rounded-full flex items-center justify-center border border-[#CCDCF3]"
        >
          <div
            class="w-12 h-12 rounded-full flex items-center justify-center bg-[#1874FF]"
          >
            <FlashIcon class="w-8 h-8 text-white" />
          </div>
        </div>
        <h1 class="ml-4 text-primary-black text-2xl font-semibold">
          Flash Liquidator
        </h1>
      </div>

      <div class="flex items-center gap-4">
        <div class="flex items-center rounded-md bg-white px-3 py-2 shadow">
          <span class="text-sm text-primary-gray mr-2">Auto-Execute</span>
          <ToggleButton :checked="autoExecute" @change="toggleAutoExecute" />
        </div>
        <ButtonCTA
          class="px-4 h-9"
          :loading="loading"
          :disabled="loading || !canRunScanner"
          @click="refreshTargets"
        >
          Refresh
        </ButtonCTA>
      </div>
    </div>

    <div class="mt-8 px-1 grid w-full grid-cols-1 gap-4 sm:grid-cols-3 xl:gap-[18px]">
      <div class="shadow rounded-lg py-6 px-6 flex flex-col">
        <h3 class="text-xs uppercase tracking-wide text-primary-gray">
          Current Profitable Targets
        </h3>
        <p class="text-3xl font-semibold text-primary-black mt-3">
          {{ profitableTargets.length }}
        </p>
      </div>
      <div class="shadow rounded-lg py-6 px-6 flex flex-col">
        <h3 class="text-xs uppercase tracking-wide text-primary-gray">
          Last Scan
        </h3>
        <p class="text-sm font-semibold text-primary-black mt-3">
          {{ lastScanText }}
        </p>
      </div>
      <div class="shadow rounded-lg py-6 px-6 flex flex-col">
        <h3 class="text-xs uppercase tracking-wide text-primary-gray">
          Best Est. Net Profit
        </h3>
        <p class="text-xl font-semibold mt-3" :class="bestProfitColor">
          {{ bestProfitText }}
        </p>
      </div>
    </div>

    <div
      v-if="!canRunScanner"
      class="mt-6 rounded-md bg-[#fff5f5] border border-[#ffc9c9] px-5 py-4 text-[#c92a2a] text-sm"
    >
      Scanner is available only on Mainnet.
    </div>

    <div
      v-if="scannerError"
      class="mt-6 rounded-md bg-[#fff5f5] border border-[#ffc9c9] px-5 py-4 text-[#c92a2a] text-sm"
    >
      {{ scannerError }}
    </div>

    <div
      v-for="warning in scannerWarnings"
      :key="warning"
      class="mt-3 rounded-md bg-[#fff9db] border border-[#ffe066] px-5 py-4 text-[#e67700] text-sm"
    >
      {{ warning }}
    </div>

    <div class="mt-8">
      <div class="w-full flex flex-col mt-6 sm:flex-row sm:items-center sm:justify-between xl:mt-4">
        <h2 class="text-primary-gray text-lg font-semibold">Scanner Targets</h2>
        <div class="mt-4 sm:mt-0 sm:mr-1 text-xs text-primary-gray">
          Sorted by profitability and position size
        </div>
      </div>

      <div
        class="mt-3 grid w-full grid-cols-1 gap-4 xxl:gap-6 min-w-max-content px-1"
      >
        <div
          v-for="target in targets"
          :key="target.user"
          class="shadow rounded-lg p-5 bg-white"
        >
          <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div class="min-w-0">
              <div class="text-xs text-primary-gray uppercase tracking-wide">
                User
              </div>
              <div class="mt-1 text-sm font-semibold text-primary-black break-all">
                {{ target.user }}
              </div>
              <div class="mt-3 flex items-center flex-wrap gap-x-4 gap-y-2 text-xs">
                <span class="text-primary-gray">
                  HF:
                  <span class="text-primary-black font-semibold">
                    {{ target.healthFactor }}
                  </span>
                </span>
                <span class="text-primary-gray">
                  Debt:
                  <span class="text-primary-black font-semibold">
                    {{ target.debtTokenSymbol }}
                  </span>
                </span>
                <span class="text-primary-gray">
                  Collateral:
                  <span class="text-primary-black font-semibold">
                    {{ target.collateralTokenSymbol }}
                  </span>
                </span>
              </div>
            </div>

            <div class="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:w-[560px]">
              <div class="rounded-md bg-[#f8f9fb] p-3">
                <div class="text-[10px] uppercase text-primary-gray">
                  Debt To Cover
                </div>
                <div class="mt-1 text-sm font-semibold text-primary-black">
                  {{ formatUsd(target.debtToCoverUsd) }}
                </div>
              </div>
              <div class="rounded-md bg-[#f8f9fb] p-3">
                <div class="text-[10px] uppercase text-primary-gray">
                  Bonus
                </div>
                <div class="mt-1 text-sm font-semibold text-primary-black">
                  {{ formatUsd(target.expectedBonusUsd) }}
                </div>
              </div>
              <div class="rounded-md bg-[#f8f9fb] p-3">
                <div class="text-[10px] uppercase text-primary-gray">
                  Fees + Gas
                </div>
                <div class="mt-1 text-sm font-semibold text-primary-black">
                  {{
                    formatUsd(
                      plus(
                        plus(target.flashloanFeeUsd, target.instadappFeeUsd),
                        target.estimatedGasUsd
                      ).toFixed()
                    )
                  }}
                </div>
              </div>
              <div class="rounded-md bg-[#f8f9fb] p-3">
                <div class="text-[10px] uppercase text-primary-gray">
                  Net Profit
                </div>
                <div
                  class="mt-1 text-sm font-semibold"
                  :class="target.isProfitable ? 'text-[#2f9e44]' : 'text-[#d64545]'"
                >
                  {{ formatUsd(target.expectedNetProfitUsd) }}
                </div>
              </div>
            </div>
          </div>

          <div class="mt-4 flex flex-wrap gap-3">
            <ButtonCTA
              class="h-9 px-4"
              :disabled="!target.isProfitable || executionPending"
              :loading="executionPending && autoExecutingUser === target.user"
              @click="openExecute(target.user)"
            >
              Execute
            </ButtonCTA>
            <div
              v-if="!target.isProfitable"
              class="text-xs text-[#d64545] flex items-center"
            >
              Unprofitable after fee + gas guardrails.
            </div>
          </div>
        </div>

        <div
          v-if="targets.length === 0 && !loading"
          class="shadow rounded-lg p-8 bg-white text-center text-primary-gray"
        >
          No liquidatable targets found. Add wallet addresses to
          <code>AAVE_V3_LIQUIDATION_WATCHLIST</code> or provide a working
          <code>AAVE_V3_SUBGRAPH_URL</code>.
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import {
  computed,
  defineComponent,
  onBeforeUnmount,
  onMounted,
  ref,
  useRouter,
  watch
} from "@nuxtjs/composition-api";
import BackIcon from "~/assets/icons/back.svg?inline";
import AaveIcon from "~/assets/icons/aave.svg?inline";
import ButtonCTA from "~/components/common/input/ButtonCTA.vue";
import ToggleButton from "~/components/common/input/ToggleButton.vue";
import { useFormatting } from "~/composables/useFormatting";
import { useBigNumber } from "~/composables/useBigNumber";
import { useLiquidationScanner } from "~/composables/protocols/useLiquidationScanner";
import { useFlashLiquidator } from "~/composables/protocols/useFlashLiquidator";

export default defineComponent({
  components: {
    BackIcon,
    FlashIcon: AaveIcon,
    ButtonCTA,
    ToggleButton
  },
  setup() {
    const router = useRouter();
    const {
      targets,
      profitableTargets,
      loading,
      scannerError,
      scannerWarnings,
      scannerRunning,
      lastScanAt,
      canRunScanner,
      refreshTargets,
      startScanner,
      stopScanner,
      topProfitableTarget
    } = useLiquidationScanner();
    const {
      executeTarget,
      pending: executionPending,
      executionError,
      clearConnectorMethodCache
    } = useFlashLiquidator();
    const { formatUsd } = useFormatting();
    const { plus } = useBigNumber();

    const autoExecute = ref(false);
    const autoExecutingUser = ref("");

    const lastScanText = computed(() => {
      if (!lastScanAt.value) {
        return "Not scanned yet";
      }

      return new Date(lastScanAt.value).toLocaleString();
    });

    const bestProfitText = computed(() => {
      if (!topProfitableTarget.value) {
        return "$0.00";
      }

      return formatUsd(topProfitableTarget.value.expectedNetProfitUsd || "0");
    });

    const bestProfitColor = computed(() =>
      topProfitableTarget.value ? "text-[#2f9e44]" : "text-primary-black"
    );

    async function runAutoExecute() {
      if (!autoExecute.value || executionPending.value) {
        return;
      }

      const target = profitableTargets.value[0];
      if (!target) {
        return;
      }

      autoExecutingUser.value = target.user;
      await executeTarget(target, true);
      autoExecutingUser.value = "";
    }

    function toggleAutoExecute(value: boolean) {
      autoExecute.value = value;
      if (value) {
        runAutoExecute();
      }
    }

    function openExecute(user: string) {
      const encodedUser = encodeURIComponent(user);
      router.push({ hash: `liquidator-execute?user=${encodedUser}` });
    }

    watch(
      profitableTargets,
      async () => {
        await runAutoExecute();
      },
      { deep: true }
    );

    watch(
      executionError,
      value => {
        if (value) {
          autoExecute.value = false;
        }
      }
    );

    onMounted(() => {
      if (!scannerRunning.value) {
        startScanner();
      }
    });

    onBeforeUnmount(() => {
      stopScanner();
    });

    return {
      targets,
      loading,
      scannerError,
      scannerWarnings,
      profitableTargets,
      executionPending,
      autoExecute,
      autoExecutingUser,
      canRunScanner,
      refreshTargets,
      openExecute,
      toggleAutoExecute,
      lastScanText,
      bestProfitText,
      bestProfitColor,
      plus,
      formatUsd
    };
  }
});
</script>
