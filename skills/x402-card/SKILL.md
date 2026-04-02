---
name: x402-card
description: >
  Use this skill when the user wants to purchase a virtual debit card using crypto,
  create a prepaid card via x402 protocol, check virtual card status, or set up an
  EVM wallet for card payments. Trigger on: "buy a card", "get a virtual card",
  "create card", "card status", "setup wallet for card", or any intent involving
  purchasing virtual Visa/Mastercard with cryptocurrency.
metadata:
  version: "0.1.0"
  author: AEON-Project
allowed-tools: Bash(npx:*) Bash(node:*) Read
---

# x402 Virtual Card Skill

Purchase virtual debit cards (Visa/Mastercard) by paying with USDT on BSC via the x402 HTTP payment protocol.

## CLI Tool

All operations use `npx @aeon-project/x402-card`:

```bash
# First time: configure service URL and wallet
npx @aeon-project/x402-card setup --service-url https://api.example.com --private-key 0x...

# Show current config
npx @aeon-project/x402-card setup --show

# Create a virtual card ($5 USD, auto-poll status)
npx @aeon-project/x402-card create --amount 5 --poll

# Check card status
npx @aeon-project/x402-card status --order-no <orderNo>

# Check wallet balance
npx @aeon-project/x402-card wallet
```

## Configuration

Config is stored at `~/.x402-card/config.json` (file permission 600). Three sources, priority from high to low:

1. **CLI flags**: `--service-url`, `--private-key`
2. **Environment variables**: `X402_CARD_SERVICE_URL`, `EVM_PRIVATE_KEY`
3. **Config file**: `~/.x402-card/config.json` (set via `setup` command)

## Decision Tree

Determine user intent and route:

### 1. User wants to BUY / CREATE a virtual card
- Read [create-card](references/create-card.md) for the full workflow.
- **Minimum amount**: $0.6 USD.
- **MUST** confirm amount with the user before running the create command.

### 2. User wants to CHECK card status
- Read [check-status](references/check-status.md) for status query details.
- Requires an `orderNo` from a previous creation.

### 3. User wants to SETUP wallet
- Read [wallet-setup](references/wallet-setup.md) for configuring the EVM wallet.
- Must be done before any card purchase.

### 4. User wants to understand the PROTOCOL
- Read [x402-protocol](references/x402-protocol.md) for how x402 works.

## Anti-patterns

- **NEVER** proceed with payment without explicit user confirmation of the amount.
- **NEVER** log or display the full private key. Mask it as `0x...last4`.
- **NEVER** skip the wallet setup check before attempting a purchase.
- **DO NOT** poll status more than 10 times. If still pending, inform the user and stop.
