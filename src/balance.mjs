/**
 * 钱包余额查询（共享模块）
 */
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, formatUnits } from "viem";
import { bsc } from "viem/chains";

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

/**
 * 查询钱包 BNB 和 USDT 余额
 * @param {string} privateKey
 * @returns {{ address: string, bnb: string, usdt: string, bnbRaw: bigint, usdtRaw: bigint }}
 */
export async function getWalletBalance(privateKey) {
  const account = privateKeyToAccount(privateKey);
  const client = createPublicClient({ chain: bsc, transport: http() });

  const [bnbRaw, usdtRaw] = await Promise.all([
    client.getBalance({ address: account.address }),
    client.readContract({
      address: USDT_BSC,
      abi: ERC20_BALANCE_ABI,
      functionName: "balanceOf",
      args: [account.address],
    }),
  ]);

  return {
    address: account.address,
    bnb: formatUnits(bnbRaw, 18),
    usdt: formatUnits(usdtRaw, 18),
    bnbRaw,
    usdtRaw,
  };
}
