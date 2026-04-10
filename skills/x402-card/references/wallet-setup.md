# Wallet Setup

## Connect via WalletConnect

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

**Requirements:**
- A mobile wallet app that supports WalletConnect (MetaMask, Trust Wallet, etc.)
- USDT (BEP-20) + small BNB in the wallet for funding

## Verify Wallet

```bash
npx @aeon-ai-pay/x402-card wallet
```

Output:
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
| Not configured | Run `connect --amount <usdt>` |
| USDT = 0 | Run `topup --amount <usdt>` |
| BNB = 0 | Run `topup --gas` |
| Wrong network | Ensure BSC mainnet, not testnet |
| WalletConnect timeout | Scan QR within 120 seconds, retry with `connect` |
