```markdown
# assembly_front Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development patterns and workflows used in the `assembly_front` TypeScript codebase. The repository focuses on managing network connectors and related configurations, with clear conventions for file naming, imports, and exports. It also outlines repeatable workflows for updating and fixing network connector logic, ensuring maintainability and consistency across contributions.

## Coding Conventions

### File Naming
- Use **camelCase** for file names.
  - Example: `useNetwork.ts`, `networkConfig.ts`

### Import Style
- Prefer **alias imports** for modules.
  - Example:
    ```typescript
    import { getNetworkConfig } from '@/connectors/index';
    ```

### Export Style
- Use **named exports**.
  - Example:
    ```typescript
    export function getNetworkConfig(networkId: string) { ... }
    ```

## Workflows

### Update Network Connector Settings
**Trigger:** When you want to add support for a new network or adjust/fix existing network connector settings.  
**Command:** `/update-network-connector`

1. Edit or add the relevant network configuration in `connectors/index.ts`.
    ```typescript
    // connectors/index.ts
    export const networks = {
      mainnet: { rpc: 'https://mainnet.rpc.url', ... },
      newNetwork: { rpc: 'https://newnetwork.rpc.url', ... }, // Add new network
    };
    ```
2. Optionally, update related composables (e.g., `composables/useNetwork.ts`) if network selection logic changes.
    ```typescript
    // composables/useNetwork.ts
    import { networks } from '@/connectors/index';
    // Update logic to include new network
    ```
3. Optionally, update environment examples (`.env.example`) if new variables are needed.
    ```
    # .env.example
    VITE_NEW_NETWORK_RPC=https://newnetwork.rpc.url
    ```
4. Optionally, add or update network icons (`assets/icons/*.svg`) for new networks.

### Address Network Connector Feedback
**Trigger:** When you need to fix or refine network connector logic based on review or bug reports.  
**Command:** `/fix-network-connector`

1. Edit `connectors/index.ts` to adjust network connector logic.
    ```typescript
    // connectors/index.ts
    networks.mainnet.rpc = 'https://updated.rpc.url'; // Fix endpoint
    ```
2. Optionally, update related composables (e.g., `composables/useNetwork.ts`) if needed.

## Testing Patterns

- **Framework:** Unknown (not detected in analysis)
- **File Pattern:** Test files follow the `*.test.*` naming convention.
  - Example: `useNetwork.test.ts`
- **Style:** Place tests alongside implementation or in a dedicated test folder.

## Commands

| Command                  | Purpose                                                        |
|--------------------------|----------------------------------------------------------------|
| /update-network-connector| Add or update network connector settings and configurations    |
| /fix-network-connector   | Address feedback or fix bugs in network connector logic        |
```