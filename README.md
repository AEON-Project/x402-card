# x402-card

Agent skill for purchasing virtual debit cards via the [x402 protocol](https://www.x402.org/).

Pay with crypto (USDT on BSC), receive a ready-to-use virtual Visa/Mastercard.

## Install Skill

```bash
# Install to all detected agents (Claude Code, Cursor, Codex, OpenClaw, Gemini CLI, etc.)
npx skills add AEON-Project/x402-card -g -y

# Install to specific agents
npx skills add AEON-Project/x402-card -a claude-code -a cursor -a codex -g -y
```

Supported agents: Claude Code, Cursor, Codex, OpenClaw, Gemini CLI, GitHub Copilot, Windsurf, Roo Code, and [39+ more](https://agentskills.io).

## CLI Usage

```bash
# First time: connect wallet via WalletConnect (private key is NEVER stored)
npx @aeon-ai-pay/x402-card connect --amount 50

# Create a virtual card ($5 USD, auto-poll status)
npx @aeon-ai-pay/x402-card create --amount 5 --poll

# Check card status
npx @aeon-ai-pay/x402-card status --order-no <orderNo>

# Check wallet balance (BNB + USDT on BSC)
npx @aeon-ai-pay/x402-card wallet

# Top up session key when balance is low
npx @aeon-ai-pay/x402-card topup --amount 50

# Show current config
npx @aeon-ai-pay/x402-card setup --show
```

## Prerequisites

- Node.js >= 18
- A mobile wallet app supporting WalletConnect (MetaMask, Trust Wallet, etc.)
- USDT (BEP-20) on BSC for card purchases
- Small BNB for gas fees (~$0.01 per tx)

## How it works

```
1. Connect wallet via WalletConnect (scan QR code, approve funding)
2. CLI generates a local session key, funded by your main wallet
3. Session key signs x402 payments automatically — no manual approval needed

Agent flow:
  User intent -> Agent activates skill -> x402 two-phase protocol:
    1. GET /create?amount=X         -> HTTP 402 + payment requirements
    2. Session key signs & retry    -> HTTP 200 + payment confirmed
    3. Poll /status?orderNo=X       -> Card details when ready
```

## Configuration

Config is stored at `~/.x402-card/config.json` (file permission 600).

Run `connect` to set up your wallet via WalletConnect. Your main wallet private key is **never** stored locally — only the session key (a limited, funded ephemeral wallet) is saved.

To override the default service URL (optional):
```bash
npx @aeon-ai-pay/x402-card setup --service-url https://custom-api.example.com
```

## License

MIT
