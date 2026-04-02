#!/usr/bin/env node

import { Command } from "commander";
import { create } from "../src/commands/create.mjs";
import { status } from "../src/commands/status.mjs";
import { wallet } from "../src/commands/wallet.mjs";
import { setup } from "../src/commands/setup.mjs";
import { upgrade } from "../src/commands/upgrade.mjs";

const program = new Command();

program
  .name("x402-card")
  .description("Purchase virtual debit cards via x402 protocol")
  .version("0.1.0");

program
  .command("setup")
  .description("Configure service URL and EVM wallet (saved to ~/.x402-card/config.json)")
  .option("--service-url <url>", "x402 card service URL")
  .option("--private-key <key>", "EVM private key (0x...)")
  .option("--show", "Show current configuration", false)
  .option("--check", "Check if configured (exit 0=ready, 1=not ready)", false)
  .action(setup);

program
  .command("create")
  .description("Create a virtual card by paying with USDT on BSC")
  .requiredOption("--amount <usd>", "Card amount in USD (min 0.6)")
  .option("--service-url <url>", "Override service URL")
  .option("--private-key <key>", "Override EVM private key")
  .option("--poll", "Auto-poll status after creation", false)
  .action(create);

program
  .command("status")
  .description("Check virtual card creation status")
  .requiredOption("--order-no <orderNo>", "Order number from create command")
  .option("--service-url <url>", "Override service URL")
  .option("--poll", "Poll until terminal status", false)
  .action(status);

program
  .command("wallet")
  .description("Check EVM wallet balance (BNB + USDT on BSC)")
  .option("--private-key <key>", "Override EVM private key")
  .action(wallet);

program
  .command("upgrade")
  .description("Check and upgrade skill to latest version from GitHub")
  .option("--check", "Only check, do not upgrade", false)
  .action(upgrade);

program.parse();
