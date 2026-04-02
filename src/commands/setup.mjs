import { loadConfig, saveConfig, getConfigPath } from "../config.mjs";
import { privateKeyToAccount } from "viem/accounts";
import { MIN_AMOUNT, MAX_AMOUNT } from "./create.mjs";

export async function setup(opts) {
  const config = loadConfig();
  let changed = false;

  // 设置 service URL
  if (opts.serviceUrl) {
    // 去除尾部斜杠
    config.serviceUrl = opts.serviceUrl.replace(/\/+$/, "");
    changed = true;
  }

  // 设置私钥
  if (opts.privateKey) {
    const key = opts.privateKey.startsWith("0x") ? opts.privateKey : `0x${opts.privateKey}`;
    // 验证私钥格式
    try {
      const account = privateKeyToAccount(key);
      config.privateKey = key;
      config.address = account.address;
      changed = true;
      console.error(`Wallet address: ${account.address}`);
    } catch (e) {
      console.error(JSON.stringify({ error: `Invalid private key: ${e.message}` }));
      process.exit(1);
    }
  }

  // --check: Agent 用来快速判断是否就绪（exit code 0=就绪, 1=未就绪）
  if (opts.check) {
    const ready = !!(config.serviceUrl && config.privateKey);
    const missing = [];
    if (!config.serviceUrl) missing.push("serviceUrl");
    if (!config.privateKey) missing.push("privateKey");
    console.log(JSON.stringify({
      ready,
      missing,
      address: config.address || null,
      serviceUrl: config.serviceUrl || null,
      amountLimits: { min: MIN_AMOUNT, max: MAX_AMOUNT },
    }));
    process.exit(ready ? 0 : 1);
  }

  if (opts.show) {
    // 显示当前配置（私钥脱敏）
    const display = { ...config };
    if (display.privateKey) {
      display.privateKey = `${display.privateKey.slice(0, 6)}...${display.privateKey.slice(-4)}`;
    }
    display._configPath = getConfigPath();
    console.log(JSON.stringify(display, null, 2));
    return;
  }

  if (!changed) {
    console.error("Usage:");
    console.error("  x402-card setup --private-key <0x...>");
    console.error("  x402-card setup --private-key <0x...> --service-url <url>  (optional)");
    console.error("  x402-card setup --show");
    console.error(`\nConfig file: ${getConfigPath()}`);
    process.exit(1);
  }

  saveConfig(config);
  console.log(JSON.stringify({
    success: true,
    configPath: getConfigPath(),
    serviceUrl: config.serviceUrl || null,
    address: config.address || null,
  }, null, 2));
}
