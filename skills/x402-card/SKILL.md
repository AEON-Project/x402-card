---
name: x402-card
description: >
  Use this skill when the user wants to purchase a virtual debit card using crypto,
  create a prepaid card via x402 protocol, check virtual card status, or set up an
  EVM wallet for card payments. Trigger on: "buy a card", "get a virtual card",
  "create card", "card status", "setup wallet for card", or any intent involving
  purchasing virtual Visa/Mastercard with cryptocurrency.
emoji: "💳"
homepage: https://github.com/AEON-Project/x402-card
metadata:
  version: "0.2.4"
  author: AEON-Project
  openclaw:
    requires:
      bins:
        - node
        - npx
    primaryEnv: X402_CARD_SERVICE_URL
    user-invocable: true
    disable-model-invocation: false
compatibility: Requires Node.js >= 18 and npm
---

# x402 Virtual Card Skill

Purchase virtual debit cards (Visa/Mastercard) by paying with USDT on BSC via the x402 HTTP payment protocol.

## CLI Tool

All operations use `npx @aeon-ai-pay/x402-card`:

```bash
# Connect wallet via WalletConnect (no private key stored)
npx @aeon-ai-pay/x402-card connect --amount 50

# Show current config
npx @aeon-ai-pay/x402-card setup --show

# Create a virtual card ($5 USD, auto-poll status)
npx @aeon-ai-pay/x402-card create --amount 5 --poll

# Check card status
npx @aeon-ai-pay/x402-card status --order-no <orderNo>

# Check wallet balance
npx @aeon-ai-pay/x402-card wallet

# Top up session key balance
npx @aeon-ai-pay/x402-card topup --amount 50
```

## Configuration

Config is stored at `~/.x402-card/config.json` (file permission 600).

Uses WalletConnect to connect user's wallet and fund a local session key. Main wallet private key is **NEVER** stored locally. **NEVER ask user for a private key.**

## Step 0: Pre-flight Checks

Before ANY operation (create, wallet, status), run these two checks **in parallel**:

### 0a. Auto-upgrade skill (background, non-blocking, once per session)

Run in background (async) only once per session, do NOT wait for result before proceeding:

```bash
npx @aeon-ai-pay/x402-card upgrade --check
```

- `"upToDate": true` → ignore.
- `"upToDate": false` → when result arrives, inform user and run upgrade:
  ```bash
  npx @aeon-ai-pay/x402-card upgrade
  ```
- Network failure → ignore silently.

### 0b. Check config (foreground, blocking)

```bash
npx @aeon-ai-pay/x402-card setup --check
```

- Exit code 0 + `"ready": true` → proceed to user intent. The response includes `amountLimits: { min, max }` — use these when prompting the user for card amount. Also check `mode` field to know which mode is active.
- Exit code 1 + `"ready": false` → wallet not configured. Run `connect` to set up via WalletConnect:
  > "I'll help you connect your wallet via WalletConnect. Your main wallet private key will NOT be stored locally."
  Ask how much USDT to fund the session key (default $50), then run:
  ```bash
  npx @aeon-ai-pay/x402-card connect --amount <usdt>
  ```
  The command will display a QR code in terminal. Ask user to scan with their wallet app (MetaMask, Trust Wallet, etc.) and approve 2 transactions (USDT + BNB transfer).
- **NEVER ask user for a private key. Always use `connect` command.**
- Do NOT ask for service URL unless the user explicitly wants to change it.

## Decision Tree

After config is verified, determine user intent and route:

### 1. User wants to BUY / CREATE a virtual card
- Read [create-card](references/create-card.md) for the full workflow.
- **Amount limits come from `setup --check` response** (`amountLimits.min` / `amountLimits.max`). Do NOT hardcode, memorize, or guess any limit values — always use the numbers returned by the CLI.
- CLI `create` command validates the amount and returns error JSON with allowed range if invalid.
- CLI will **auto-check** wallet balance before payment. If insufficient, it reports the shortfall.
- **MUST** confirm amount with the user before running the create command. Show the range from `amountLimits` so the user knows the valid range.

### 2. User wants to CHECK card status
- Read [check-status](references/check-status.md) for status query details.
- Requires an `orderNo` from a previous creation.

### 3. User wants to SETUP or CONNECT wallet
- Read [wallet-setup](references/wallet-setup.md) for connecting the wallet via WalletConnect.
- Must be done before any card purchase.
- Always use `connect` command. Never ask for private key.

### 4. User wants to TOP UP session key
- Only applicable in session-key mode. Run:
  ```bash
  npx @aeon-ai-pay/x402-card topup --amount <usdt>
  ```
  This re-opens WalletConnect for a one-shot funding transfer.

### 5. User wants to understand the PROTOCOL
- Read [x402-protocol](references/x402-protocol.md) for how x402 works.

## Anti-patterns

- **NEVER** ask user for a private key. Always use `connect` (WalletConnect) to set up wallet.
- **NEVER** proceed with payment without explicit user confirmation of the amount.
- **NEVER** log or display the full private key. Mask it as `0x...last4`.
- **NEVER** skip the wallet setup check before attempting a purchase.
- **DO NOT** poll status more than 10 times. If still pending, inform the user and stop.

## Insufficient Balance Handling

When create returns `"error": "Insufficient USDT balance"`:

```
Session key USDT balance is insufficient.
- Required: {required}
- Available: {available}

Run 'x402-card topup --amount <usdt>' to add funds via WalletConnect.
```
