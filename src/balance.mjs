/**
 * 钱包余额查询（共享模块）
 */
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, formatUnits } from "viem";
import { bsc } from "viem/chains";
import { BSC_RPC_URL } from "./constants.mjs";

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

let cachedClient = null;

function getClient() {
  if (!cachedClient) {
    cachedClient = createPublicClient({
      chain: bsc,
      transport: http(BSC_RPC_URL, { timeout: 6000, retryCount: 1 }),
    });
  }
  return cachedClient;
}

/**
 * 查询钱包 BNB 和 USDT 余额
 * @param {string} privateKey
 */
export async function getWalletBalance(privateKey) {
  const account = privateKeyToAccount(privateKey);
  const address = account.address;
  const client = getClient();

  const [bnbRaw, usdtRaw] = await Promise.all([
    client.getBalance({ address }),
    client.readContract({
      address: USDT_BSC,
      abi: ERC20_BALANCE_ABI,
      functionName: "balanceOf",
      args: [address],
    }),
  ]);

  return {
    address,
    bnb: formatUnits(bnbRaw, 18),
    usdt: formatUnits(usdtRaw, 18),
    bnbRaw,
    usdtRaw,
  };
}
