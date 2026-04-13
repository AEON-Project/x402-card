/**
 * WalletConnect v2 封装模块
 * 用于通过 WalletConnect 协议连接用户钱包并发起交易
 */
import { SignClient } from "@walletconnect/sign-client";
import qrcode from "qrcode-terminal";
import { encodeFunctionData, parseUnits } from "viem";
import { writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";
import { WC_CONNECT_TIMEOUT_MS } from "./constants.mjs";

const BSC_CHAIN_ID = "eip155:56";

const ERC20_TRANSFER_ABI = [
  {
    name: "transfer",
    type: "function",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "success", type: "bool" }],
    stateMutability: "nonpayable",
  },
];

/**
 * 生成 QR 码 HTML 页面并在浏览器中打开
 */
function openQRInBrowser(uri) {
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>x402-card — Connect Wallet</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { min-height: 100vh; display: flex; align-items: center; justify-content: center;
         background: #0a0a0a; color: #fff; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
  .card { text-align: center; padding: 40px; border-radius: 20px; background: #1a1a1a;
          box-shadow: 0 8px 32px rgba(0,0,0,0.4); max-width: 420px; }
  h1 { font-size: 22px; margin-bottom: 8px; }
  p { font-size: 14px; color: #888; margin-bottom: 24px; }
  #qr { margin: 0 auto 24px; }
  .hint { font-size: 13px; color: #666; }
  canvas { border-radius: 12px; }
</style>
<script src="https://cdn.jsdelivr.net/npm/qrious@4.0.2/dist/qrious.min.js"></script>
</head><body>
<div class="card">
  <h1>Connect Wallet</h1>
  <p>Scan the QR code with MetaMask, Trust Wallet, or any WalletConnect-compatible wallet</p>
  <canvas id="qr"></canvas>
  <div class="hint">Waiting for connection... This page will close automatically.</div>
</div>
<script>
  new QRious({ element: document.getElementById('qr'), value: ${JSON.stringify(uri)},
    size: 280, backgroundAlpha: 0, foreground: '#ffffff', level: 'M' });
</script>
</body></html>`;

  const filePath = join(tmpdir(), "x402-card-qr.html");
  writeFileSync(filePath, html);

  // 跨平台打开浏览器
  const cmd = process.platform === "darwin" ? "open" :
              process.platform === "win32" ? "start" : "xdg-open";
  try {
    execSync(`${cmd} ${filePath}`, { stdio: "ignore" });
  } catch {
    console.error(`Open this file in your browser: ${filePath}`);
  }
}

/**
 * 初始化 WalletConnect SignClient
 * @param {string} projectId - WalletConnect Cloud project ID
 */
export async function initSignClient(projectId) {
  return await SignClient.init({
    projectId,
    metadata: {
      name: "x402-card",
      description: "Virtual debit card via x402 protocol",
      url: "https://github.com/AEON-Project/x402-card",
      icons: [],
    },
  });
}

/**
 * 连接钱包：展示 QR 码，等待用户扫码授权
 * @param {SignClient} signClient
 * @returns {{ session: object, peerAddress: string }}
 */
export async function connectWallet(signClient) {
  const { uri, approval } = await signClient.connect({
    optionalNamespaces: {
      eip155: {
        methods: ["eth_sendTransaction"],
        chains: [BSC_CHAIN_ID],
        events: ["chainChanged", "accountsChanged"],
      },
    },
  });

  // 生成 QR 码页面并在浏览器中打开
  openQRInBrowser(uri);
  console.error("QR code opened in browser. Scan it with your wallet app.");
  console.error("Waiting for wallet approval...");

  // 等待用户授权，设置超时
  const session = await Promise.race([
    approval(),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("WalletConnect connection timed out (120s). Please try again.")),
        WC_CONNECT_TIMEOUT_MS,
      ),
    ),
  ]);

  // 从 session 中提取连接的钱包地址
  const accounts = session.namespaces.eip155.accounts; // ["eip155:56:0xABC..."]
  const peerAddress = accounts[0].split(":")[2];
  return { session, peerAddress };
}

/**
 * 请求 ERC-20 代币转账
 * @param {SignClient} signClient
 * @param {object} session - WalletConnect session
 * @param {{ from: string, to: string, token: string, amount: string, decimals?: number }} params
 * @returns {string} 交易 hash
 */
export async function requestERC20Transfer(signClient, session, { from, to, token, amount, decimals = 18 }) {
  const value = parseUnits(amount, decimals);
  const data = encodeFunctionData({
    abi: ERC20_TRANSFER_ABI,
    functionName: "transfer",
    args: [to, value],
  });

  const txHash = await signClient.request({
    topic: session.topic,
    chainId: BSC_CHAIN_ID,
    request: {
      method: "eth_sendTransaction",
      params: [
        {
          from,
          to: token,
          data,
        },
      ],
    },
  });

  return txHash;
}

/**
 * 请求原生 BNB 转账
 * @param {SignClient} signClient
 * @param {object} session
 * @param {{ from: string, to: string, value: string }} params - value 为 BNB 数量（如 "0.001"）
 * @returns {string} 交易 hash
 */
export async function requestNativeTransfer(signClient, session, { from, to, value }) {
  const weiValue = "0x" + parseUnits(value, 18).toString(16);

  const txHash = await signClient.request({
    topic: session.topic,
    chainId: BSC_CHAIN_ID,
    request: {
      method: "eth_sendTransaction",
      params: [
        {
          from,
          to,
          value: weiValue,
        },
      ],
    },
  });

  return txHash;
}

/**
 * 断开 WalletConnect 会话
 * @param {SignClient} signClient
 * @param {object} session
 */
export async function disconnectSession(signClient, session) {
  try {
    await signClient.disconnect({
      topic: session.topic,
      reason: { code: 6000, message: "Session complete" },
    });
  } catch {
    // 静默处理断开错误
  }
}
