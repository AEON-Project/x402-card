# x402-card

Agent skill for purchasing virtual debit cards via the [x402 protocol](https://www.x402.org/).

Pay with crypto (USDT on BSC), receive a ready-to-use virtual Visa/Mastercard.

## Install

```bash
# Install to all detected agents (Claude Code, Cursor, Codex, etc.)
npx skills add AEON-Project/x402-card --global --yes

# Install to a specific agent
npx skills add AEON-Project/x402-card -a claude-code -g -y
```

## What it does

| Command | Description |
|---------|-------------|
| "Buy a virtual card" | Create a virtual debit card via x402 payment |
| "Check card status" | Query card creation progress and details |
| "Setup wallet" | Configure EVM wallet for payments |

## Prerequisites

- Node.js >= 18
- An EVM wallet with USDT (BEP-20) on BSC
- Access to the x402 card service endpoint

## How it works

```
User intent -> Agent activates skill -> x402 two-phase protocol:
  1. GET /create?amount=X         -> HTTP 402 + payment requirements
  2. Sign & retry with payment    -> HTTP 200 + card info
  3. Poll /status?orderNo=X       -> Card details when ready
```

## License

MIT
