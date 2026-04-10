import { loadConfig, saveConfig, getConfigPath } from "../config.mjs";
import { MIN_AMOUNT, MAX_AMOUNT } from "../constants.mjs";

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
      const { privateKeyToAccount } = await import("viem/accounts");
      const account = privateKeyToAccount(key);
      config.privateKey = key;
      config.address = account.address;
      config.mode = "private-key";
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
    const result = {
      ready,
      mode: config.mode || null,
      address: config.address || null,
      mainWallet: config.mainWallet || null,
      serviceUrl: config.serviceUrl || null,
      amountLimits: { min: MIN_AMOUNT, max: MAX_AMOUNT },
    };
    if (!ready) {
      result.setupRequired = "wallet";
      result.setupHint = "Run 'npx @aeon-ai-pay/x402-card connect --amount <usdt>' to connect wallet via WalletConnect. Do NOT ask user for a private key.";
    }
    console.log(JSON.stringify(result));
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
    console.error("  x402-card connect                                        (recommended: WalletConnect + session key)");
    console.error("  x402-card setup --private-key <0x...>                    (legacy: direct private key)");
    console.error("  x402-card setup --private-key <0x...> --service-url <url>");
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
