/**
 * 钱包余额查询（共享模块）
 * 并发请求多个 BSC RPC 节点，谁先返回用谁
 */
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, formatUnits } from "viem";
import { bsc } from "viem/chains";

const USDT_BSC = "0x55d398326f99059fF775485246999027B3197955";

const BSC_RPC_URLS = [
  "https://bsc-dataseed.bnbchain.org",
  "https://bsc-dataseed1.ninicoin.io",
  "https://bsc-dataseed2.defibit.io",
  "https://bsc-rpc.publicnode.com",
];

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
 * 用单个 RPC 查询余额
 */
async function queryWithRpc(rpcUrl, address) {
  const client = createPublicClient({
    chain: bsc,
    transport: http(rpcUrl, { timeout: 6000, retryCount: 0 }),
  });

  const [bnbRaw, usdtRaw] = await Promise.all([
    client.getBalance({ address }),
    client.readContract({
      address: USDT_BSC,
      abi: ERC20_BALANCE_ABI,
      functionName: "balanceOf",
      args: [address],
    }),
  ]);

  return { bnbRaw, usdtRaw };
}

/**
 * 查询钱包 BNB 和 USDT 余额（并发竞速，最快节点胜出）
 * @param {string} privateKey
 */
export async function getWalletBalance(privateKey) {
  const account = privateKeyToAccount(privateKey);
  const address = account.address;

  // 所有节点并发，用 Promise.any 取最快成功的
  const { bnbRaw, usdtRaw } = await Promise.any(
    BSC_RPC_URLS.map((url) => queryWithRpc(url, address))
  );

  return {
    address,
    bnb: formatUnits(bnbRaw, 18),
    usdt: formatUnits(usdtRaw, 18),
    bnbRaw,
    usdtRaw,
  };
}
