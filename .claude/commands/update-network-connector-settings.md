---
name: update-network-connector-settings
description: Workflow command scaffold for update-network-connector-settings in assembly_front.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /update-network-connector-settings

Use this workflow when working on **update-network-connector-settings** in `assembly_front`.

## Goal

Updates or fixes network connector configurations, such as RPC endpoints or network prioritization.

## Common Files

- `connectors/index.ts`
- `composables/useNetwork.ts`
- `.env.example`
- `assets/icons/*.svg`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Edit or add relevant network configuration in 'connectors/index.ts'.
- Optionally update related composables (e.g., 'composables/useNetwork.ts') if network selection logic changes.
- Optionally update environment examples (e.g., '.env.example') if new variables are needed.
- Optionally add or update network icons (e.g., 'assets/icons/*.svg') for new networks.

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.