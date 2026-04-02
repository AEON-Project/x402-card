import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, formatUnits } from "viem";
import { bsc } from "viem/chains";
import { resolve } from "../config.mjs";

const USDT_BSC = "0x55d398326f99059fF775485246999027B3197955";

const ERC20_BALANCE_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
];

export async function wallet(opts) {
  const privateKey = resolve(opts.privateKey, "EVM_PRIVATE_KEY", "privateKey");

  if (!privateKey) {
    console.error(JSON.stringify({ error: "Missing private key. Run: x402-card setup --private-key <0x...>" }));
    process.exit(1);
  }

  try {
    const account = privateKeyToAccount(privateKey);
    const client = createPublicClient({ chain: bsc, transport: http() });

    const [bnbBalance, usdtBalance] = await Promise.all([
      client.getBalance({ address: account.address }),
      client.readContract({
        address: USDT_BSC,
        abi: ERC20_BALANCE_ABI,
        functionName: "balanceOf",
        args: [account.address],
      }),
    ]);

    const result = {
      address: account.address,
      bnb: formatUnits(bnbBalance, 18),
      usdt: formatUnits(usdtBalance, 18),
      network: "BSC Mainnet (Chain ID: 56)",
    };

    console.log(JSON.stringify(result, null, 2));

    if (usdtBalance === 0n) {
      console.error("Warning: No USDT balance. Deposit USDT (BEP-20) before purchasing cards.");
    }
    if (bnbBalance === 0n) {
      console.error("Warning: No BNB for gas fees.");
    }
  } catch (error) {
    console.error(JSON.stringify({ error: error.message }));
    process.exit(1);
  }
}
