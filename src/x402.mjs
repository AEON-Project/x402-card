/**
 * x402 协议客户端：初始化 EVM signer + x402Client
 */
import { x402Client, wrapAxiosWithPayment, x402HTTPClient } from "@aeon-ai-pay/axios";
import { registerExactEvmScheme } from "@aeon-ai-pay/evm/exact/client";
import { toClientEvmSigner } from "@aeon-ai-pay/evm";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http, publicActions } from "viem";
import { bsc } from "viem/chains";
import axios from "axios";

/**
 * 创建已注册 EVM 签名的 x402 axios 客户端
 * @param {`0x${string}`} privateKey - EVM 私钥
 * @returns {{ api: AxiosInstance, client: x402Client, address: string, getOrderNo: () => string|null }}
 */
export function createX402Api(privateKey) {
  const evmAccount = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({
    account: evmAccount,
    chain: bsc,
    transport: http(),
  }).extend(publicActions);

  const evmSigner = toClientEvmSigner({
    address: evmAccount.address,
    signTypedData: (message) => evmAccount.signTypedData(message),
    readContract: (args) =>
      walletClient.readContract({ ...args, args: args.args || [] }),
    sendTransaction: (args) =>
      walletClient.sendTransaction({ to: args.to, data: args.data }),
    waitForTransactionReceipt: (args) =>
      walletClient.waitForTransactionReceipt(args),
  });

  const client = new x402Client();
  registerExactEvmScheme(client, { signer: evmSigner });

  const axiosInstance = axios.create();

  // 在 wrapAxiosWithPayment 之前注册拦截器，
  // 从 402 响应体中捕获 orderNo（服务端在 firstRequest 返回）
  let capturedOrderNo = null;
  axiosInstance.interceptors.response.use(
    (response) => response,
    (error) => {
      if (error.response?.status === 402 && error.response?.data?.orderNo) {
        capturedOrderNo = error.response.data.orderNo;
      }
      return Promise.reject(error);
    }
  );

  const api = wrapAxiosWithPayment(axiosInstance, client);

  return {
    api,
    client,
    address: evmAccount.address,
    getOrderNo: () => capturedOrderNo,
  };
}

/**
 * 从响应头中解码 PAYMENT-RESPONSE
 * @param {object} headers - axios response headers
 * @returns {object|null}
 */
export function decodePaymentResponse(headers) {
  const raw =
    headers["payment-response"] ||
    headers["PAYMENT-RESPONSE"] ||
    headers["x-payment-response"] ||
    headers["X-PAYMENT-RESPONSE"];
  if (!raw) return null;
  try {
    return JSON.parse(Buffer.from(raw, "base64").toString("utf-8"));
  } catch {
    return { raw };
  }
}
