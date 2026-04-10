#!/usr/bin/env node

import { Command } from "commander";

const program = new Command();

program
  .name("x402-card")
  .description("Purchase virtual debit cards via x402 protocol")
  .version("0.1.0");

program
  .command("setup")
  .description("Check or show wallet config. Use 'connect' to set up wallet via WalletConnect.")
  .option("--service-url <url>", "Override service URL")
  .option("--private-key <key>", "Legacy: direct private key (use 'connect' instead)")
  .option("--show", "Show current configuration", false)
  .option("--check", "Check if configured (exit 0=ready, 1=not ready)", false)
  .action(async (opts) => {
    const { setup } = await import("../src/commands/setup.mjs");
    return setup(opts);
  });

program
  .command("create")
  .description("Create a virtual card by paying with USDT on BSC")
  .requiredOption("--amount <usd>", "Card amount in USD ($0.6 ~ $800)")
  .option("--service-url <url>", "Override service URL")
  .option("--private-key <key>", "Override EVM private key")
  .option("--poll", "Auto-poll status after creation", false)
  .action(async (opts) => {
    const { create } = await import("../src/commands/create.mjs");
    return create(opts);
  });

program
  .command("status")
  .description("Check virtual card creation status")
  .requiredOption("--order-no <orderNo>", "Order number from create command")
  .option("--service-url <url>", "Override service URL")
  .option("--poll", "Poll until terminal status", false)
  .action(async (opts) => {
    const { status } = await import("../src/commands/status.mjs");
    return status(opts);
  });

program
  .command("wallet")
  .description("Check EVM wallet balance (BNB + USDT on BSC)")
  .option("--private-key <key>", "Override EVM private key")
  .action(async (opts) => {
    const { wallet } = await import("../src/commands/wallet.mjs");
    return wallet(opts);
  });

program
  .command("connect")
  .description("Connect wallet via WalletConnect, create funded session key (recommended)")
  .option("--amount <usdt>", "USDT amount to fund session key", "50")
  .option("--gas <bnb>", "BNB for gas fees", "0.001")
  .option("--project-id <id>", "WalletConnect Cloud project ID")
  .action(async (opts) => {
    const { connect } = await import("../src/commands/connect.mjs");
    return connect(opts);
  });

program
  .command("topup")
  .description("Top up session key balance via WalletConnect")
  .option("--amount <usdt>", "USDT amount to add", "50")
  .option("--gas", "Also send BNB for gas", false)
  .option("--project-id <id>", "WalletConnect Cloud project ID")
  .action(async (opts) => {
    const { topup } = await import("../src/commands/topup.mjs");
    return topup(opts);
  });

program
  .command("withdraw")
  .description("Withdraw USDT from session key back to main wallet")
  .option("--amount <usdt>", "USDT amount to withdraw (default: all)")
  .option("--to <address>", "Override destination address")
  .action(async (opts) => {
    const { withdraw } = await import("../src/commands/withdraw.mjs");
    return withdraw(opts);
  });

program.parse();
