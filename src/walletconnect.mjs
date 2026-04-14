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
import { createServer } from "http";
import { WC_CONNECT_TIMEOUT_MS } from "./constants.mjs";

// ============== 状态同步服务器（供浏览器页面轮询） ==============

let _status = { state: "waiting_scan" };
let _server = null;
let _port = null;

export function startStatusServer() {
  _status = { state: "waiting_scan", ts: Date.now() };
  return new Promise((resolve) => {
    _server = createServer((req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/status") {
        res.end(JSON.stringify(_status));
      } else {
        res.statusCode = 404;
        res.end();
      }
    });
    _server.listen(0, "127.0.0.1", () => {
      _port = _server.address().port;
      resolve(_port);
    });
  });
}

export function setStatus(state, extra = {}) {
  _status = { state, ...extra, ts: Date.now() };
}

export function stopStatusServer() {
  if (_server) {
    try { _server.close(); } catch {}
    _server = null;
    _port = null;
  }
}

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
function openQRInBrowser(uri, statusPort) {
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>x402-card — Wallet</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { min-height: 100vh; display: flex; align-items: center; justify-content: center;
         background: #0a0a0a; color: #fff; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
  .card { text-align: center; padding: 40px; border-radius: 20px; background: #1a1a1a;
          box-shadow: 0 8px 32px rgba(0,0,0,0.4); max-width: 460px; min-width: 380px; }
  h1 { font-size: 22px; margin-bottom: 8px; }
  .sub { font-size: 14px; color: #888; margin-bottom: 24px; line-height: 1.5; }
  #qr { margin: 0 auto 24px; }
  .hint { font-size: 13px; color: #666; }
  canvas { border-radius: 12px; }
  .icon { font-size: 64px; margin: 12px 0 20px; line-height: 1; }
  .spinner { display: inline-block; width: 56px; height: 56px; border: 5px solid #2a2a2a;
             border-top-color: #4ade80; border-radius: 50%; animation: spin 0.9s linear infinite;
             margin: 8px 0 20px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .pill { display: inline-block; padding: 4px 10px; border-radius: 999px;
          font-size: 12px; background: #2a2a2a; color: #aaa; margin-top: 8px;
          font-family: ui-monospace, monospace; }
  .check { color: #4ade80; }
  .err { color: #f87171; }
  .warn { color: #fbbf24; }
  a { color: #60a5fa; text-decoration: none; font-size: 12px; word-break: break-all; }
</style>
<script src="https://cdn.jsdelivr.net/npm/qrious@4.0.2/dist/qrious.min.js"></script>
</head><body>
<div class="card" id="root">
  <h1 id="title">Connect Wallet</h1>
  <div class="sub" id="sub">Scan the QR code with MetaMask, Trust Wallet, or any WalletConnect-compatible wallet</div>
  <div id="body">
    <canvas id="qr"></canvas>
    <div class="hint">Waiting for scan...</div>
  </div>
</div>
<script>
  const URI = ${JSON.stringify(uri)};
  const STATUS_URL = "http://127.0.0.1:${statusPort}/status";
  new QRious({ element: document.getElementById('qr'), value: URI,
    size: 280, backgroundAlpha: 0, foreground: '#ffffff', level: 'M' });

  const VIEWS = {
    waiting_scan: () => \`
      <canvas id="qr"></canvas>
      <div class="hint">Waiting for scan...</div>
    \`,
    connected: (d) => \`
      <div class="spinner"></div>
      <div class="hint">Wallet connected. Please confirm the transaction in your wallet app.</div>
      \${d.peerAddress ? '<div class="pill">' + short(d.peerAddress) + '</div>' : ''}
    \`,
    signing: (d) => \`
      <div class="spinner"></div>
      <div class="hint">Awaiting signature...<br>\${d.amount || ''} \${d.token || ''} → \${short(d.to || '')}</div>
    \`,
    tx_submitted: (d) => \`
      <div class="spinner"></div>
      <div class="hint">Transaction submitted. Waiting for on-chain confirmation...</div>
      \${d.txHash ? '<a href="https://bscscan.com/tx/' + d.txHash + '" target="_blank">' + short(d.txHash) + '</a>' : ''}
    \`,
    confirmed: (d) => \`
      <div class="icon check">✅</div>
      <div class="hint">Payment complete. You can close this page.</div>
      \${d.txHash ? '<a href="https://bscscan.com/tx/' + d.txHash + '" target="_blank">' + short(d.txHash) + '</a>' : ''}
    \`,
    rejected: () => \`
      <div class="icon warn">⚠️</div>
      <div class="hint">Transaction rejected in wallet.</div>
    \`,
    failed: (d) => \`
      <div class="icon err">❌</div>
      <div class="hint">\${d.error || 'Operation failed.'}</div>
    \`,
  };

  const TITLES = {
    waiting_scan: 'Connect Wallet',
    connected: 'Wallet Connected',
    signing: 'Awaiting Signature',
    tx_submitted: 'Confirming On-chain',
    confirmed: 'Success',
    rejected: 'Cancelled',
    failed: 'Error',
  };

  function short(s) { if (!s || s.length < 12) return s; return s.slice(0,6) + '...' + s.slice(-4); }

  const FINAL = ['confirmed', 'rejected', 'failed'];
  let lastState = null;
  let closeTimer = null;
  let stopped = false;

  function maybeAutoClose(state) {
    if (closeTimer || !FINAL.includes(state)) return;
    let n = 3;
    const tick = () => {
      const el = document.getElementById('countdown');
      if (el) el.textContent = '(closing in ' + n + 's)';
      if (n-- <= 0) { try { window.close(); } catch {} return; }
      closeTimer = setTimeout(tick, 1000);
    };
    const body = document.getElementById('body');
    body.innerHTML += '<div class="hint" id="countdown" style="margin-top:12px"></div>';
    tick();
  }

  async function poll() {
    if (stopped) return;
    try {
      const r = await fetch(STATUS_URL);
      const data = await r.json();
      if (data.state !== lastState) {
        lastState = data.state;
        document.getElementById('title').textContent = TITLES[data.state] || data.state;
        document.getElementById('sub').style.display = (data.state === 'waiting_scan') ? 'block' : 'none';
        const view = VIEWS[data.state] || (() => '<div class="hint">' + data.state + '</div>');
        document.getElementById('body').innerHTML = view(data);
        if (data.state === 'waiting_scan') {
          new QRious({ element: document.getElementById('qr'), value: URI,
            size: 280, backgroundAlpha: 0, foreground: '#ffffff', level: 'M' });
        }
        maybeAutoClose(data.state);
      }
    } catch (e) {
      // 服务器关闭 → CLI 已退出，停止轮询
      if (FINAL.includes(lastState)) { stopped = true; return; }
    }
    setTimeout(poll, 800);
  }
  poll();
</script>
</body></html>`;

  const filePath = join(tmpdir(), "x402-card-qr.html");
  writeFileSync(filePath, html);

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
export async function connectWallet(signClient, statusPort) {
  const { uri, approval } = await signClient.connect({
    optionalNamespaces: {
      eip155: {
        methods: ["eth_sendTransaction"],
        chains: [BSC_CHAIN_ID],
        events: ["chainChanged", "accountsChanged"],
      },
    },
  });

  // 生成 QR 码页面（含状态轮询）并在浏览器中打开
  openQRInBrowser(uri, statusPort);
  console.error("QR code opened in browser. Scan it with your wallet app.");
  console.error("Waiting for wallet approval...");

  const session = await Promise.race([
    approval(),
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("WalletConnect connection timed out (120s). Please try again.")),
        WC_CONNECT_TIMEOUT_MS,
      ),
    ),
  ]);

  const accounts = session.namespaces.eip155.accounts;
  const peerAddress = accounts[0].split(":")[2];
  setStatus("connected", { peerAddress });
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
