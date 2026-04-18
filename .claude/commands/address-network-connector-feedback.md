---
name: address-network-connector-feedback
description: Workflow command scaffold for address-network-connector-feedback in assembly_front.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /address-network-connector-feedback

Use this workflow when working on **address-network-connector-feedback** in `assembly_front`.

## Goal

Addresses review feedback or bug fixes related to network connector logic, such as fallback RPCs or endpoint corrections.

## Common Files

- `connectors/index.ts`
- `composables/useNetwork.ts`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Edit 'connectors/index.ts' to adjust network connector logic.
- Optionally update related composables (e.g., 'composables/useNetwork.ts') if needed.

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.