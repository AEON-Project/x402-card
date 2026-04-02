import { resolve } from "../config.mjs";
import { getWalletBalance } from "../balance.mjs";

export async function wallet(opts) {
  const privateKey = resolve(opts.privateKey, "EVM_PRIVATE_KEY", "privateKey");

  if (!privateKey) {
    console.error(JSON.stringify({ error: "Missing private key. Run: x402-card setup --private-key <0x...>" }));
    process.exit(1);
  }

  try {
    const { address, bnb, usdt, bnbRaw, usdtRaw } = await getWalletBalance(privateKey);

    console.log(JSON.stringify({
      address,
      bnb,
      usdt,
      network: "BSC Mainnet (Chain ID: 56)",
    }, null, 2));

    if (usdtRaw === 0n) {
      console.error("Warning: No USDT balance. Deposit USDT (BEP-20) before purchasing cards.");
    }
    if (bnbRaw === 0n) {
      console.error("Warning: No BNB for gas fees.");
    }
  } catch (error) {
    console.error(JSON.stringify({ error: error.message }));
    process.exit(1);
  }
}
