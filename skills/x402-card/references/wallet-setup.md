# Wallet Setup

## Two Setup Methods

### Method 1: WalletConnect (Recommended)

Connect your existing wallet via WalletConnect. Your main wallet private key is **never stored locally**.

```bash
npx @aeon-ai-pay/x402-card connect --amount 50
```

**Flow:**
1. CLI generates a local session key (ephemeral wallet)
2. Displays a QR code in terminal
3. User scans QR with wallet app (MetaMask, Trust Wallet, etc.)
4. User approves USDT transfer to session key (confirm in wallet app)
5. User approves small BNB transfer for gas (confirm in wallet app)
6. Done — session key is funded and ready

**Options:**
- `--amount <usdt>` — USDT to fund (default: 50)
- `--gas <bnb>` — BNB for gas fees (default: 0.001)
- `--project-id <id>` — WalletConnect project ID (has built-in default)

**Requirements:**
- A mobile wallet app that supports WalletConnect (MetaMask, Trust Wallet, etc.)
- USDT (BEP-20) + small BNB in the wallet for funding

### Method 2: Direct Private Key (Legacy)

```bash
npx @aeon-ai-pay/x402-card setup --private-key 0x...
```

Service URL has a built-in default — no need to configure unless you want to override.

**Security:**
- NEVER commit `.env` or private keys to git
- Use a dedicated wallet, not a personal wallet with large holdings

## Verify Wallet

```bash
npx @aeon-ai-pay/x402-card wallet
```

Output (session-key mode):
```json
{
  "mode": "session-key",
  "address": "0x<session-key-address>",
  "bnb": "0.001",
  "usdt": "50.00",
  "network": "BSC Mainnet (Chain ID: 56)",
  "mainWallet": {
    "address": "0x<main-wallet-address>",
    "bnb": "1.05",
    "usdt": "500.00"
  }
}
```

## Top Up Session Key

When session key balance is low:

```bash
npx @aeon-ai-pay/x402-card topup --amount 50
```

This re-opens WalletConnect to transfer additional USDT. Add `--gas` flag to also send BNB.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Not configured | Run `connect` (recommended) or `setup --private-key` |
| USDT = 0 (session-key) | Run `topup --amount <usdt>` |
| USDT = 0 (private-key) | Transfer USDT (BEP-20) to wallet address |
| BNB = 0 | Transfer BNB for gas fees, or `topup --gas` |
| Wrong network | Ensure BSC mainnet, not testnet |
| WalletConnect timeout | Scan QR within 120 seconds, retry with `connect` |
