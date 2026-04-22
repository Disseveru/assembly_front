<template>
  <SidebarContextRootContainer>
    <template #title>Execute Liquidation</template>

    <div class="bg-[#C5CCE1] bg-opacity-[0.15] mt-10 p-8">
      <h3 class="text-primary-gray text-xs font-semibold mb-2.5">
        Target User
      </h3>
      <p class="text-sm text-primary-black break-all">{{ target && target.user }}</p>

      <div class="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div class="rounded-md bg-white p-4">
          <div class="text-xs text-primary-gray">Debt / Collateral</div>
          <div class="mt-1 text-sm font-semibold text-primary-black">
            {{ target && target.debtTokenSymbol }} / {{ target && target.collateralTokenSymbol }}
          </div>
        </div>
        <div class="rounded-md bg-white p-4">
          <div class="text-xs text-primary-gray">Health Factor</div>
          <div class="mt-1 text-sm font-semibold text-primary-black">
            {{ (target && target.healthFactor) || "-" }}
          </div>
        </div>
      </div>

      <div class="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div class="rounded-md bg-white p-4">
          <div class="text-xs text-primary-gray">Debt To Cover</div>
          <div class="mt-1 text-sm font-semibold text-primary-black">
            {{ formatUsd((target && target.debtToCoverUsd) || "0") }}
          </div>
        </div>
        <div class="rounded-md bg-white p-4">
          <div class="text-xs text-primary-gray">Expected Net Profit</div>
          <div
            class="mt-1 text-sm font-semibold"
            :class="target && target.isProfitable ? 'text-[#2f9e44]' : 'text-[#d64545]'"
          >
            {{ formatUsd((target && target.expectedNetProfitUsd) || "0") }}
          </div>
        </div>
      </div>

      <div class="mt-6 rounded-md bg-white p-4 text-xs text-primary-gray leading-relaxed">
        Execution runs only in Simulation Mode (Tenderly fork). If your connector set
        does not include an Aave V3 liquidation method, execution will fail safely
        while scanner + profitability analytics stay active.
      </div>

      <div class="flex flex-shrink-0 mt-10">
        <ButtonCTA
          class="w-full"
          :disabled="!target || pending"
          :loading="pending"
          @click="cast"
        >
          Execute Liquidation
        </ButtonCTA>
      </div>

      <ValidationErrors
        :error-messages="errorMessages"
        class="mt-6"
      />
    </div>
  </SidebarContextRootContainer>
</template>

<script lang="ts">
import { computed, defineComponent } from "@nuxtjs/composition-api";
import { useSidebar } from "~/composables/useSidebar";
import { useFormatting } from "~/composables/useFormatting";
import { useLiquidationScanner } from "~/composables/protocols/useLiquidationScanner";
import { useFlashLiquidator } from "~/composables/protocols/useFlashLiquidator";
import ButtonCTA from "~/components/common/input/ButtonCTA.vue";

export default defineComponent({
  components: { ButtonCTA },
  props: {
    user: { type: String, required: true }
  },
  setup(props) {
    const { close } = useSidebar();
    const { formatUsd } = useFormatting();
    const { getTargetByUser } = useLiquidationScanner();
    const { executeTarget, pending, executionError } = useFlashLiquidator();

    const target = computed(() => getTargetByUser(props.user));

    const errorMessages = computed(() => {
      const errors = [];

      if (!target.value) {
        errors.push("Target is no longer in scanner results. Refresh and retry.");
      }

      if (executionError.value) {
        errors.push(executionError.value);
      }

      return errors;
    });

    async function cast() {
      if (!target.value) {
        return;
      }

      await executeTarget(target.value);
      if (!executionError.value) {
        close();
      }
    }

    return {
      target,
      pending,
      cast,
      formatUsd,
      errorMessages
    };
  }
});
</script>
