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

// 5 分钟超时（毫秒）
const QR_EXPIRE_MS = 5 * 60 * 1000;

/**
 * 生成 QR 码 HTML 页面并在浏览器中打开（按 Figma Ai card v1.2 设计稿）
 */
function openQRInBrowser(uri, statusPort) {
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>AEON — Wallet Connect</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    min-height: 100vh; display: flex; flex-direction: column; align-items: center;
    justify-content: flex-start; padding-top: 40px;
    background: #f7f7f7; color: #191b1f;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  .logo { margin-bottom: 24px; }
  .card {
    text-align: center; padding: 32px 24px; border-radius: 12px; background: #fff;
    border: 1px solid #e5e5e5; max-width: 375px; width: 100%; min-height: 436px;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
  }
  .title { font-size: 18px; font-weight: 700; color: #191b1f; margin-bottom: 12px; line-height: 1.4; }
  .timer { display: flex; align-items: center; gap: 6px; font-size: 16px; font-weight: 500; color: #1972f6; margin-bottom: 20px; }
  .timer svg { flex-shrink: 0; }
  .qr-wrap { padding: 12px; border-radius: 16px; border: 1px solid #e5e5e5; margin-bottom: 20px; display: inline-block; }
  canvas { display: block; border-radius: 8px; }
  .status-row { display: flex; flex-direction: column; align-items: center; gap: 8px; margin-bottom: 16px; }
  .spinner-dots { display: flex; gap: 4px; justify-content: center; }
  .spinner-dots span { width: 6px; height: 6px; border-radius: 50%; background: #00b42a; animation: blink 1.4s infinite both; }
  .spinner-dots span:nth-child(2) { animation-delay: 0.2s; }
  .spinner-dots span:nth-child(3) { animation-delay: 0.4s; }
  @keyframes blink { 0%,80%,100% { opacity: 0.3; } 40% { opacity: 1; } }
  .status-text { font-size: 14px; font-weight: 400; color: #00b42a; }
  .check-icon { width: 24px; height: 24px; border-radius: 50%; background: #00b42a; display: flex; align-items: center; justify-content: center; }
  .check-icon svg { width: 14px; height: 14px; }
  .hint-bar {
    display: flex; align-items: flex-start; gap: 8px; padding: 10px 12px; border-radius: 8px;
    background: #f4f5f5; font-size: 12px; color: #737a86; line-height: 1.5; text-align: left; width: 100%;
  }
  .hint-bar svg { flex-shrink: 0; margin-top: 1px; }
  .result-card { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 40px 24px; }
  .result-title { font-size: 18px; font-weight: 500; color: #191b1f; }
  .result-sub { font-size: 14px; color: #191b1f; line-height: 1.6; text-align: center; }
  a { color: #1972f6; text-decoration: none; font-size: 12px; word-break: break-all; }
</style>
<script src="https://cdn.jsdelivr.net/npm/qrious@4.0.2/dist/qrious.min.js"><\/script>
</head><body>

<!-- AEON Logo -->
<div class="logo">
  <svg width="107" height="32" viewBox="0 0 107 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <g clip-path="url(#lc)">
      <path d="M24.6 6.41c-.94-2.26-3.09-3.6-7.41-1.8a22.5 22.5 0 0 1 4.44 1.76c.84-.23 1.8-.28 2.97.04Z" fill="#58F287"/>
      <path d="M5.88 9.25c.33-.9 1-2 2.34-2.64.4-.19.87-.33 1.4-.42h.29l.26-.03c.38-.03.79-.03 1.22 0l.33.03c.29.03.58.09.9.15l.19.04.14.03.46.12.16.04.16.05c.1.03.19.06.29.09l.25.07c.22.07.42.15.65.22l.26.1.29.1c3.41 1.33 8.05 5.67 9.21 6.8v-.06c.17-.62.33-1.41.42-2.25.1-.96.13-1.99.01-2.99-2.04-1.62-4.7-3.26-7.95-4.09h-.04l-.19-.04c-.13-.03-.26-.06-.39-.09-1.04-.23-2.13-.38-3.28-.42-5.6-.19-7.35 3.12-7.72 6.41.03-.23.12-.68.31-1.21Z" fill="#58F287"/>
      <path d="M6.91 24.74c-.77-.58-1.64-1.55-1.84-2.99-.06-.44-.06-.91.03-1.44v-.1l.04-.15v-.03c.01-.09.03-.16.06-.25.09-.36.22-.74.39-1.13l.13-.3c.12-.26.26-.52.42-.78l.1-.16.07-.13c.09-.13.16-.26.25-.39l.09-.13.09-.13c.06-.09.12-.16.17-.25.05-.07.1-.13.15-.2.13-.17.28-.35.42-.54.06-.07.12-.14.17-.21.06-.07.13-.16.19-.23 2.36-2.76 8-5.71 9.47-6.47h-.04c-.55-.36-1.26-.74-2.06-1.09-.9-.39-1.9-.72-2.9-.94-2.22 1.39-4.63 3.36-6.44 6.12v.03l-.1.16c-.07.12-.15.23-.22.35-.57.9-1.06 1.87-1.46 2.93-1.91 5.15.78 7.79 3.87 9.15-.22-.1-.64-.32-1.07-.65Z" fill="#58F287"/>
      <path d="M22.29 28.55c-.81.54-2.02 1.06-3.48.8-.44-.07-.91-.23-1.39-.47h-.09l-.14-.07h-.03l-.22-.13c-.32-.2-.65-.43-.98-.71l-.25-.22c-.22-.19-.42-.41-.64-.63l-.13-.14-.1-.12c-.1-.12-.2-.23-.31-.36l-.1-.13-.1-.13-.19-.25-.14-.2c-.13-.17-.26-.36-.39-.55-.06-.07-.1-.16-.16-.23-.06-.09-.1-.16-.16-.25-1.94-3.05-3.09-9.21-3.36-10.79l-.04.03c-.52.41-1.12.94-1.7 1.58-.65.71-1.29 1.54-1.81 2.41.67 2.48 1.84 5.34 3.98 7.87h.03c.04.04.09.1.12.14.09.1.17.2.26.3.7.78 1.5 1.52 2.41 2.22 4.41 3.37 7.82 1.7 10.09-.78-.17.17-.5.49-.97.8Z" fill="#58F287"/>
      <path d="M20.63 3.51c.97.03 2.26.3 3.29 1.36.3.32.59.71.84 1.17l.04.09.07.14v.03c.03.07.07.15.1.23.15.35.26.73.37 1.15l.07.32c.06.28.1.57.13.87l.02.19v.15c0 .14.03.3.03.46v.87c0 .22 0 .44-.01.67v.28l-.01.29c-.25 3.58-3.03 9.22-3.77 10.66h.06c.67-.03 1.46-.13 2.32-.3.96-.2 1.97-.49 2.92-.92.96-2.39 1.73-5.38 1.52-8.66v-.23l-.03-.39c-.1-1.03-.29-2.1-.61-3.18C26.4 3.49 22.66 2.9 19.32 3.57c.25-.04.7-.1 1.26-.09Z" fill="#58F287"/>
      <path d="M17.35 28.5c2.12 1.29 4.77.74 6.82-2.42-1.57.59-3.13.94-4.64 1.13-.54.67-1.03.87-2.18 1.29ZM29.18 20.03c1.91-1.57 2.15-4.42-.18-7.11.11 1.64-.04 3.21-.33 4.66.48.71.45 1.26.51 2.45ZM9.54 6.53c-2.45.4-4.08 2.75-3.41 6.23.74-1.46 1.64-2.76 2.63-3.87-.06-.86.23-1.32.78-2.36ZM30.78 15.44c.28.91.41 2.2-.3 3.48-.22.39-.49.77-.88 1.15l-.07.07-.12.1h-.03c-.06.06-.13.12-.19.16-.29.23-.62.46-1 .7l-.29.16c-.25.13-.52.28-.81.39-.06.03-.12.06-.17.07-.05 0-.09.04-.14.06-.15.06-.29.12-.44.17l-.16.06-.16.06c-.1.03-.19.07-.29.1-.09.03-.16.06-.25.07-.22.07-.44.13-.66.19l-.35.07c-.1.03-.2.05-.29.07-3.57.87-9.92.03-11.55-.22v.06c.23.61.58 1.32 1.02 2.06.49.83 1.1 1.68 1.78 2.42 2.63.14 5.77-.06 8.9-1.27h.04l.17-.07c.13-.04.25-.1.38-.16.97-.41 1.96-.92 2.9-1.55 4.64-3.06 4.08-6.75 2.38-9.62.12.2.32.62.48 1.15Z" fill="#58F287"/>
      <path d="M7.62 21.98c-.75-.27-1.41-.77-2.13-1.62-.54 2.31.77 4.51 4.66 5.48-1.78-1.94-2.25-3.16-2.53-3.86ZM10.43 25.89c-.2-.23-.39-.46-.58-.71.17.25.36.48.55.7Z" fill="#58F287"/>
      <path d="M45.27 10.43 40.22 25.82h-4.07l6.9-18.56h2.59l-.37 3.17Zm4.19 15.39-5.06-15.39-.41-3.17h2.61l6.94 18.56h-4.08Zm-.23-6.91v2.99h-9.8v-2.99h9.8Zm18.48 3.93v2.98H57.84v-2.98h9.88Zm1.25-15.56v18.56h-3.82V7.26h3.82Zm7.34 7.56v2.91h-8.59v-2.91h8.59Zm1.28-7.56v3h-9.87v-3h9.87Zm17.49 8.85v.88c0 1.41-.19 2.68-.58 3.8-.38 1.12-.92 2.08-1.62 2.87-.7.78-1.53 1.38-2.5 1.8-.96.42-2.03.62-3.2.62-1.16 0-2.23-.2-3.2-.62-.96-.42-1.79-1.02-2.5-1.8-.7-.79-1.25-1.75-1.64-2.87-.38-1.12-.57-2.39-.57-3.8v-.88c0-1.42.19-2.69.57-3.8.38-1.12.92-2.08 1.62-2.87.7-.79 1.53-1.39 2.5-1.81.97-.42 2.03-.62 3.2-.62s2.24.2 3.2.62c.97.42 1.8 1.02 2.5 1.81.7.79 1.25 1.75 1.63 2.87.39 1.11.59 2.38.59 3.8Zm-3.86.88v-.9c0-.99-.09-1.86-.27-2.6-.18-.75-.44-1.38-.79-1.89-.35-.51-.78-.89-1.28-1.15-.5-.26-1.07-.39-1.72-.39-.65 0-1.22.13-1.72.39-.49.26-.91.64-1.26 1.15-.34.51-.6 1.14-.78 1.89-.18.75-.27 1.61-.27 2.6v.9c0 .98.09 1.85.27 2.6.18.75.44 1.38.79 1.89.35.51.77.9 1.28 1.15.5.26 1.07.4 1.72.4s1.07-.14 1.58-.4c.5-.26.92-.64 1.26-1.15.34-.52.6-1.14.78-1.89.18-.76.27-1.62.27-2.6Zm21.72-9.73v18.56h-3.82L99.24 13.38v12.44h-3.83V7.26h3.83l7.47 12.45V7.26h3.81Z" fill="#000"/>
    </g>
    <defs><clipPath id="lc"><rect width="106.803" height="32" fill="#fff"/></clipPath></defs>
  </svg>
</div>

<div class="card" id="root">
  <div id="body"></div>
</div>

<script>
  const URI = ${JSON.stringify(uri)};
  const STATUS_URL = "http://127.0.0.1:${statusPort}/status";
  const EXPIRE_MS = ${QR_EXPIRE_MS};
  const startTime = Date.now();

  // 倒计时 SVG 图标
  const CLOCK_SVG = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="9" cy="9" r="8" stroke="#1972f6" stroke-width="1.5"/><path d="M9 5v4.5l3 1.5" stroke="#1972f6" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  // 提示 info 图标
  const INFO_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="7" stroke="#737a86" stroke-width="1.2"/><path d="M8 7v4M8 5.5v.01" stroke="#737a86" stroke-width="1.2" stroke-linecap="round"/></svg>';
  // 成功勾选
  const CHECK_SVG = '<div class="check-icon"><svg viewBox="0 0 14 14" fill="none"><path d="M3 7l3 3 5-5" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>';

  // 超时插图 SVG（从 Figma 导出）
  const EXPIRED_SVG = \`<svg width="144" height="129" viewBox="0 0 144 129" fill="none" xmlns="http://www.w3.org/2000/svg">
<path opacity="0.1" d="M140.369 64.988C140.369 82.769 133.106 98.797 121.461 110.317C110.066 121.711 94.289 128.598 76.884 128.598C59.604 128.598 43.826 121.586 32.306 110.317C20.661 98.797 13.398 82.769 13.398 64.988C13.398 29.802 41.823 1.377 76.884 1.377C111.944 1.377 140.369 29.927 140.369 64.988Z" fill="#1A72F7"/>
<path d="M134.859 23.291C137.695 23.291 139.993 20.992 139.993 18.157C139.993 15.321 137.695 13.023 134.859 13.023C132.024 13.023 129.725 15.321 129.725 18.157C129.725 20.992 132.024 23.291 134.859 23.291Z" fill="#E8F1FE"/>
<path d="M141.496 5.009C142.879 5.009 144 3.887 144 2.504C144 1.121 142.879 0 141.496 0C140.113 0 138.991 1.121 138.991 2.504C138.991 3.887 140.113 5.009 141.496 5.009Z" fill="#E8F1FE"/>
<path d="M15.402 23.165C17.338 23.165 18.908 21.596 18.908 19.659C18.908 17.723 17.338 16.153 15.402 16.153C13.465 16.153 11.896 17.723 11.896 19.659C11.896 21.596 13.465 23.165 15.402 23.165Z" fill="#E8F1FE"/>
<path d="M5.635 90.157C8.747 90.157 11.27 87.634 11.27 84.522C11.27 81.41 8.747 78.887 5.635 78.887C2.523 78.887 0 81.41 0 84.522C0 87.634 2.523 90.157 5.635 90.157Z" fill="#E8F1FE"/>
<path d="M106.435 31.68C114.733 31.68 121.461 38.407 121.461 46.706V110.317C110.066 121.711 94.289 128.598 76.884 128.598C59.604 128.598 43.826 121.586 32.306 110.317V46.706C32.306 38.407 39.034 31.68 47.332 31.68H106.435Z" fill="white"/>
<path d="M76.383 82.644C86.756 82.644 95.165 74.235 95.165 63.861C95.165 53.488 86.756 45.079 76.383 45.079C66.009 45.079 57.6 53.488 57.6 63.861C57.6 74.235 66.009 82.644 76.383 82.644Z" fill="url(#pe)"/>
<path d="M75.708 53.393C76.824 53.393 77.742 54.312 77.742 55.428V63.129C77.742 63.319 77.832 63.627 78.015 63.95C78.2 64.274 78.418 64.505 78.577 64.597L78.583 64.601L84.403 68.074C85.39 68.652 85.673 69.904 85.114 70.864L85.104 70.879C84.708 71.513 84.038 71.869 83.352 71.869C83.013 71.868 82.648 71.79 82.306 71.566L76.495 68.099C74.859 67.122 73.673 65.02 73.673 63.129V55.428C73.673 54.312 74.592 53.393 75.708 53.393Z" fill="url(#ph)" filter="url(#fs)"/>
<path d="M88.529 92.286H65.238C63.855 92.286 62.734 93.407 62.734 94.79C62.734 96.173 63.855 97.294 65.238 97.294H88.529C89.912 97.294 91.033 96.173 91.033 94.79C91.033 93.407 89.912 92.286 88.529 92.286Z" fill="url(#pb1)"/>
<path d="M97.169 104.807H56.598C55.215 104.807 54.094 105.929 54.094 107.312C54.094 108.695 55.215 109.816 56.598 109.816H97.169C98.552 109.816 99.673 108.695 99.673 107.312C99.673 105.929 98.552 104.807 97.169 104.807Z" fill="url(#pb2)"/>
<defs>
<filter id="fs" x="71.169" y="52.141" width="16.733" height="23.484" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feFlood flood-opacity="0" result="bg"/><feColorMatrix in="SourceAlpha" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="a"/><feOffset dy="1.25"/><feGaussianBlur stdDeviation="1.25"/><feComposite in2="a" operator="out"/><feColorMatrix values="0 0 0 0 .98 0 0 0 0 .59 0 0 0 0 .2 0 0 0 .5 0"/><feBlend in2="bg" result="s"/><feBlend in="SourceGraphic" in2="s"/></filter>
<linearGradient id="pe" x1="123.339" y1="36.939" x2="27.548" y2="92.661" gradientUnits="userSpaceOnUse"><stop stop-color="#FF7D00"/><stop offset="1" stop-color="#FF7D00" stop-opacity="0"/></linearGradient>
<linearGradient id="ph" x1="78.327" y1="62.004" x2="70.624" y2="69.133" gradientUnits="userSpaceOnUse"><stop stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity=".2"/></linearGradient>
<linearGradient id="pb1" x1="62.608" y1="92.035" x2="93.286" y2="92.286" gradientUnits="userSpaceOnUse"><stop stop-color="#DBDEE3" stop-opacity=".7"/><stop offset="1" stop-color="#DBDEE3"/></linearGradient>
<linearGradient id="pb2" x1="53.891" y1="104.557" x2="103.297" y2="105.207" gradientUnits="userSpaceOnUse"><stop stop-color="#DBDEE3" stop-opacity=".7"/><stop offset="1" stop-color="#DBDEE3"/></linearGradient>
</defs></svg>\`;

  // 拒绝插图 SVG（基于超时插图，替换时钟为 X 标记，橙色改红色）
  const REJECTED_SVG = \`<svg width="144" height="129" viewBox="0 0 144 129" fill="none" xmlns="http://www.w3.org/2000/svg">
<path opacity="0.1" d="M140.369 64.988C140.369 82.769 133.106 98.797 121.461 110.317C110.066 121.711 94.289 128.598 76.884 128.598C59.604 128.598 43.826 121.586 32.306 110.317C20.661 98.797 13.398 82.769 13.398 64.988C13.398 29.802 41.823 1.377 76.884 1.377C111.944 1.377 140.369 29.927 140.369 64.988Z" fill="#1A72F7"/>
<path d="M134.859 23.291C137.695 23.291 139.993 20.992 139.993 18.157C139.993 15.321 137.695 13.023 134.859 13.023C132.024 13.023 129.725 15.321 129.725 18.157C129.725 20.992 132.024 23.291 134.859 23.291Z" fill="#E8F1FE"/>
<path d="M141.496 5.009C142.879 5.009 144 3.887 144 2.504C144 1.121 142.879 0 141.496 0C140.113 0 138.991 1.121 138.991 2.504C138.991 3.887 140.113 5.009 141.496 5.009Z" fill="#E8F1FE"/>
<path d="M15.402 23.165C17.338 23.165 18.908 21.596 18.908 19.659C18.908 17.723 17.338 16.153 15.402 16.153C13.465 16.153 11.896 17.723 11.896 19.659C11.896 21.596 13.465 23.165 15.402 23.165Z" fill="#E8F1FE"/>
<path d="M5.635 90.157C8.747 90.157 11.27 87.634 11.27 84.522C11.27 81.41 8.747 78.887 5.635 78.887C2.523 78.887 0 81.41 0 84.522C0 87.634 2.523 90.157 5.635 90.157Z" fill="#E8F1FE"/>
<path d="M106.435 31.68C114.733 31.68 121.461 38.407 121.461 46.706V110.317C110.066 121.711 94.289 128.598 76.884 128.598C59.604 128.598 43.826 121.586 32.306 110.317V46.706C32.306 38.407 39.034 31.68 47.332 31.68H106.435Z" fill="white"/>
<circle cx="76.383" cy="63.861" r="18.783" fill="url(#pr)"/>
<path d="M69.383 56.861l14 14M83.383 56.861l-14 14" stroke="white" stroke-width="3" stroke-linecap="round"/>
<path d="M88.529 92.286H65.238C63.855 92.286 62.734 93.407 62.734 94.79C62.734 96.173 63.855 97.294 65.238 97.294H88.529C89.912 97.294 91.033 96.173 91.033 94.79C91.033 93.407 89.912 92.286 88.529 92.286Z" fill="url(#prb1)"/>
<path d="M97.169 104.807H56.598C55.215 104.807 54.094 105.929 54.094 107.312C54.094 108.695 55.215 109.816 56.598 109.816H97.169C98.552 109.816 99.673 108.695 99.673 107.312C99.673 105.929 98.552 104.807 97.169 104.807Z" fill="url(#prb2)"/>
<defs>
<linearGradient id="pr" x1="123.339" y1="36.939" x2="27.548" y2="92.661" gradientUnits="userSpaceOnUse"><stop stop-color="#F53F3F"/><stop offset="1" stop-color="#F53F3F" stop-opacity="0"/></linearGradient>
<linearGradient id="prb1" x1="62.608" y1="92.035" x2="93.286" y2="92.286" gradientUnits="userSpaceOnUse"><stop stop-color="#DBDEE3" stop-opacity=".7"/><stop offset="1" stop-color="#DBDEE3"/></linearGradient>
<linearGradient id="prb2" x1="53.891" y1="104.557" x2="103.297" y2="105.207" gradientUnits="userSpaceOnUse"><stop stop-color="#DBDEE3" stop-opacity=".7"/><stop offset="1" stop-color="#DBDEE3"/></linearGradient>
</defs></svg>\`;

  function short(s) { if (!s || s.length < 12) return s; return s.slice(0,6) + '...' + s.slice(-4); }

  function fmtTime(ms) {
    if (ms <= 0) return '00:00';
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  // ====== 页面渲染函数 ======

  function renderQR(data) {
    const remaining = Math.max(0, EXPIRE_MS - (Date.now() - startTime));
    const isWaiting = !data || data.state === 'waiting_scan';
    const isConnected = data && (data.state === 'connected' || data.state === 'signing' || data.state === 'tx_submitted');
    const isConfirmed = data && data.state === 'confirmed';

    let statusHTML = '';
    if (isConfirmed) {
      statusHTML = '<div class="status-row">' + CHECK_SVG + '<div class="status-text">Waiting for results...</div></div>';
    } else {
      statusHTML = '<div class="status-row"><div class="spinner-dots"><span></span><span></span><span></span></div><div class="status-text">Waiting for results...</div></div>';
    }

    const expireMin = Math.ceil(remaining / 60000);

    return '<div class="title">Scan the QR code with your wallet<br>to authorize transfer</div>' +
      '<div class="timer">' + CLOCK_SVG + ' ' + fmtTime(remaining) + ' Remaining</div>' +
      '<div class="qr-wrap"><canvas id="qr"></canvas></div>' +
      statusHTML +
      '<div class="hint-bar">' + INFO_SVG + '<span>Expire in ' + expireMin + ' mins. This page will close automatically once the transfer is completed</span></div>';
  }

  function renderExpired() {
    return '<div class="result-card">' + EXPIRED_SVG +
      '<div class="result-title">Request expired</div>' +
      '<div class="result-sub">This request has expired.<br>Ask agent to send a new one</div></div>';
  }

  function renderRejected() {
    return '<div class="result-card">' + REJECTED_SVG +
      '<div class="result-title">Request rejected</div>' +
      '<div class="result-sub">You have rejected this request.<br>Ask agent to send a new one</div></div>';
  }

  function renderFailed(error) {
    return '<div class="result-card">' + REJECTED_SVG +
      '<div class="result-title">Transaction failed</div>' +
      '<div class="result-sub">' + (error || 'Operation failed.') + '<br>Ask agent to send a new one</div></div>';
  }

  // ====== 状态机 ======

  const FINAL = ['confirmed', 'rejected', 'failed', 'expired'];
  let lastState = null;
  let stopped = false;
  let closeTimer = null;
  let timerInterval = null;

  function render(data) {
    const body = document.getElementById('body');
    const state = data ? data.state : 'waiting_scan';

    if (state === 'expired') {
      body.innerHTML = renderExpired();
      stopTimer();
    } else if (state === 'rejected') {
      body.innerHTML = renderRejected();
      stopTimer();
    } else if (state === 'failed') {
      body.innerHTML = renderFailed(data.error);
      stopTimer();
    } else {
      body.innerHTML = renderQR(data);
      // 渲染 QR 码
      const qrEl = document.getElementById('qr');
      if (qrEl) {
        new QRious({ element: qrEl, value: URI, size: 200, backgroundAlpha: 1, background: '#ffffff', foreground: '#000000', level: 'M' });
      }
    }
  }

  function stopTimer() {
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  }

  function maybeAutoClose(state) {
    if (closeTimer || !FINAL.includes(state)) return;
    let n = 5;
    const tick = () => {
      if (n-- <= 0) { try { window.close(); } catch {} return; }
      closeTimer = setTimeout(tick, 1000);
    };
    closeTimer = setTimeout(tick, 1000);
  }

  // 初始渲染
  render(null);

  // 倒计时刷新（每秒更新 timer）
  timerInterval = setInterval(() => {
    const remaining = EXPIRE_MS - (Date.now() - startTime);
    if (remaining <= 0 && !FINAL.includes(lastState)) {
      lastState = 'expired';
      render({ state: 'expired' });
      maybeAutoClose('expired');
      return;
    }
    // 更新倒计时文字
    const timerEl = document.querySelector('.timer');
    if (timerEl) {
      const expireMin = Math.ceil(Math.max(0, remaining) / 60000);
      timerEl.innerHTML = CLOCK_SVG + ' ' + fmtTime(remaining) + ' Remaining';
      // 更新 hint-bar 里的分钟数
      const hintSpan = document.querySelector('.hint-bar span');
      if (hintSpan) hintSpan.textContent = 'Expire in ' + expireMin + ' mins. This page will close automatically once the transfer is completed';
    }
  }, 1000);

  // 轮询后端状态
  async function poll() {
    if (stopped) return;
    try {
      const r = await fetch(STATUS_URL);
      const data = await r.json();
      if (data.state !== lastState) {
        lastState = data.state;
        render(data);
        maybeAutoClose(data.state);
        if (FINAL.includes(data.state)) { stopped = true; stopTimer(); return; }
      }
    } catch (e) {
      if (FINAL.includes(lastState)) { stopped = true; stopTimer(); return; }
    }
    setTimeout(poll, 800);
  }
  poll();
<\/script>
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
        () => {
          setStatus("expired");
          reject(new Error("WalletConnect connection timed out (5min). Please try again."));
        },
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
