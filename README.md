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
# First time: provide your EVM wallet private key
npx @aeon-ai-pay/x402-card setup --private-key 0x...

# Show current config
npx @aeon-ai-pay/x402-card setup --show

# Create a virtual card ($5 USD, auto-poll status)
npx @aeon-ai-pay/x402-card create --amount 5 --poll

# Check card status
npx @aeon-ai-pay/x402-card status --order-no <orderNo>

# Check wallet balance (BNB + USDT on BSC)
npx @aeon-ai-pay/x402-card wallet
```

## Prerequisites

- Node.js >= 18
- An EVM wallet with USDT (BEP-20) on BSC
- Small BNB for gas fees (~$0.01 per tx)

## How it works

```
User intent -> Agent activates skill -> x402 two-phase protocol:
  1. GET /create?amount=X         -> HTTP 402 + payment requirements
  2. EVM sign & retry             -> HTTP 200 + payment confirmed
  3. Poll /status?orderNo=X       -> Card details when ready
```

## Configuration

Only `--private-key` is required. Service URL has a built-in default.

Priority (high to low):
1. CLI flags (`--private-key`, `--service-url`)
2. Environment variables (`EVM_PRIVATE_KEY`, `X402_CARD_SERVICE_URL`)
3. Config file (`~/.x402-card/config.json`, set via `setup` command)

To override the default service URL (optional):
```bash
npx @aeon-ai-pay/x402-card setup --service-url https://custom-api.example.com
```

## License

MIT
