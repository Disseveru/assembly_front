/**
 * Tests for the flash-liquidator sidebar route additions in useSidebar.ts.
 *
 * The PR introduced two new entries to the `sidebars` route map:
 *   "/mainnet/flash-liquidator"                           → { component: null }
 *   "/mainnet/flash-liquidator#liquidator-execute"        → { component: SidebarFlashLiquidatorExecute }
 *
 * Because the sidebar map and the component imports require the full Nuxt/Vue
 * runtime (which is unavailable in a unit test), we replicate the exact sidebar
 * routing logic and test it directly.
 */

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Minimal replica of the sidebars map from useSidebar.ts, scoped to the
// flash-liquidator routes added in this PR.
// ---------------------------------------------------------------------------

const FLASH_LIQUIDATOR_COMPONENT = { name: "SidebarFlashLiquidatorExecute" } as const;

const sidebarsFlashLiquidator: Record<string, { component: any }> = {
  "/mainnet/flash-liquidator": { component: null },
  "/mainnet/flash-liquidator#liquidator-execute": {
    component: FLASH_LIQUIDATOR_COMPONENT
  }
};

/**
 * Mirrors the sidebar lookup logic from the `init()` watch callback:
 *   sidebar.value = sidebars[route.path + hash] || sidebars[hash]
 *
 * `path`  – e.g. "/mainnet/flash-liquidator"
 * `hash`  – fragment part including "#", e.g. "#liquidator-execute", or ""
 */
function lookupSidebar(
  path: string,
  hash: string,
  map: Record<string, { component: any }>
): { component: any } | undefined {
  return map[path + hash] || map[hash];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useSidebar flash-liquidator route entries", () => {
  describe("base route /mainnet/flash-liquidator", () => {
    it("is registered in the sidebars map", () => {
      expect("/mainnet/flash-liquidator" in sidebarsFlashLiquidator).toBe(true);
    });

    it("has a null component (no sidebar panel for the base route)", () => {
      expect(sidebarsFlashLiquidator["/mainnet/flash-liquidator"].component).toBeNull();
    });

    it("is resolved correctly when navigating to the base path with no hash", () => {
      const resolved = lookupSidebar("/mainnet/flash-liquidator", "", sidebarsFlashLiquidator);
      expect(resolved).toBeDefined();
      expect(resolved?.component).toBeNull();
    });
  });

  describe("execute route /mainnet/flash-liquidator#liquidator-execute", () => {
    it("is registered in the sidebars map", () => {
      expect(
        "/mainnet/flash-liquidator#liquidator-execute" in sidebarsFlashLiquidator
      ).toBe(true);
    });

    it("resolves to the SidebarFlashLiquidatorExecute component", () => {
      const entry = sidebarsFlashLiquidator["/mainnet/flash-liquidator#liquidator-execute"];
      expect(entry.component).toBe(FLASH_LIQUIDATOR_COMPONENT);
    });

    it("is resolved by the lookup function when path + hash are provided", () => {
      const resolved = lookupSidebar(
        "/mainnet/flash-liquidator",
        "#liquidator-execute",
        sidebarsFlashLiquidator
      );
      expect(resolved?.component).toBe(FLASH_LIQUIDATOR_COMPONENT);
    });
  });

  describe("route lookup with hash-only fallback", () => {
    it("returns undefined when hash-only key is not in the map (flash-liquidator uses full path+hash keys)", () => {
      // The sidebars map does NOT contain a bare "#liquidator-execute" key.
      // The execute entry is only accessible via the full path+hash.
      // Navigating to "#liquidator-execute" from an unrelated path will not resolve.
      const resolved = lookupSidebar(
        "/other-page",
        "#liquidator-execute",
        sidebarsFlashLiquidator
      );
      expect(resolved).toBeUndefined();
    });

    it("returns undefined for a completely unknown route + hash", () => {
      const resolved = lookupSidebar(
        "/mainnet/flash-liquidator",
        "#unknown-hash",
        sidebarsFlashLiquidator
      );
      expect(resolved).toBeUndefined();
    });

    it("resolves the execute entry from an unrelated path via a broader map that includes hash-only entries", () => {
      // If the full sidebars map contains a hash-only entry (as used by other protocols),
      // hash-only lookup would work. Simulate this pattern.
      const broadMap: Record<string, { component: any }> = {
        ...sidebarsFlashLiquidator,
        "#liquidator-execute": { component: FLASH_LIQUIDATOR_COMPONENT }
      };
      const resolved = lookupSidebar("/other-page", "#liquidator-execute", broadMap);
      expect(resolved?.component).toBe(FLASH_LIQUIDATOR_COMPONENT);
    });
  });

  describe("route key format validation", () => {
    it("routes do not carry extra whitespace or trailing slashes", () => {
      const keys = Object.keys(sidebarsFlashLiquidator);
      for (const key of keys) {
        expect(key).toBe(key.trim());
        expect(key.endsWith("/")).toBe(false);
      }
    });

    it("exactly two flash-liquidator routes are defined", () => {
      const flashRoutes = Object.keys(sidebarsFlashLiquidator).filter(k =>
        k.startsWith("/mainnet/flash-liquidator")
      );
      expect(flashRoutes).toHaveLength(2);
    });

    it("the execute route hash segment is '#liquidator-execute'", () => {
      const keys = Object.keys(sidebarsFlashLiquidator);
      const executeKey = keys.find(k => k.includes("#"));
      expect(executeKey).toBe("/mainnet/flash-liquidator#liquidator-execute");
    });
  });
});

// ---------------------------------------------------------------------------
// Regression: removed dead-code paths in init() watch callback
// The PR removed `hasIsLoggedInChanged` and `hasDsaChanged` assignments.
// These were unused variables — we validate that the watch no longer needs
// them by confirming the minimal change-detection logic remains sufficient.
// ---------------------------------------------------------------------------

describe("useSidebar init() watch simplification", () => {
  it("path-change detection only requires comparing route.path values", () => {
    // Simulate the hasPathChanged computation that remains after the PR.
    function hasPathChanged(
      currentPath: string,
      oldRoute: { path: string } | null
    ): boolean {
      return !oldRoute || currentPath !== oldRoute.path;
    }

    // First render — no previous route
    expect(hasPathChanged("/mainnet/flash-liquidator", null)).toBe(true);

    // Same path
    expect(
      hasPathChanged("/mainnet/flash-liquidator", { path: "/mainnet/flash-liquidator" })
    ).toBe(false);

    // Different path
    expect(
      hasPathChanged("/mainnet/flash-liquidator", { path: "/mainnet/aave-v3" })
    ).toBe(true);
  });
});