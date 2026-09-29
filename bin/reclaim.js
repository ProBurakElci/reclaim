#!/usr/bin/env node
/*
 * reclaim - find the build artifacts eating your disk, then delete them safely.
 *
 *   npx reclaim                 report on the current folder (nothing is deleted)
 *   npx reclaim ~/code          report on a folder
 *   npx reclaim --older-than 60 only what nobody has touched in 60 days
 *   npx reclaim --delete        actually delete, after confirmation
 *
 * The default is always a report. Deleting needs --delete and a typed yes.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { scan, totalBytes, daysSince, olderThan } = require("../lib/scan");
const { removeAll, canRemove } = require("../lib/remove");

const FORCED = process.env.FORCE_COLOR && process.env.FORCE_COLOR !== "0";
const NO_COLOR = process.env.NO_COLOR || (!FORCED && !process.stdout.isTTY);
const c = (code, text) => (NO_COLOR ? text : "\u001b[" + code + "m" + text + "\u001b[0m");
const red = (t) => c("31", t);
const green = (t) => c("32", t);
const yellow = (t) => c("33", t);
const cyan = (t) => c("36", t);
const violet = (t) => c("35", t);
const dim = (t) => c("90", t);
const bold = (t) => c("1", t);

function parseArgs(argv) {
  const options = { root: process.cwd(), top: 15 };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === "--delete") options.delete = true;
    else if (arg === "--yes" || arg === "-y") options.yes = true;
    else if (arg === "--older-than") options.olderThan = Number(next), i++;
    else if (arg === "--min-size") options.minSize = Number(next), i++;
    else if (arg === "--top") options.top = Number(next), i++;
    else if (arg === "--all") options.top = Infinity;
    else if (arg === "--depth") options.depth = Number(next), i++;
    else if (arg === "--json") options.json = true;
    else if (arg === "--no-color") options.noColor = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (!arg.startsWith("-")) options.root = path.resolve(arg);
  }

  return options;
}

function usage() {
  console.log(`
  ${bold("reclaim")} - find the build artifacts eating your disk

  Usage
    npx reclaim [path]            report on a folder (default: here)

  Options
    --older-than <days>   only artifacts nothing has touched in N days
    --min-size <MB>       ignore anything smaller
    --top <n>             how many rows to print (default 15)
    --all                 print every row
    --depth <n>           how deep to walk (default 8)
    --delete              delete them, after a confirmation
    --yes                 skip the confirmation (for scripts)
    --json                machine-readable output

  Nothing is deleted unless you pass --delete. Everything on the list can be
  rebuilt with the command shown next to it.
`);
}

function humanSize(bytes) {
  if (bytes >= 1024 ** 3) return (bytes / 1024 ** 3).toFixed(1) + " GB";
  if (bytes >= 1024 ** 2) return (bytes / 1024 ** 2).toFixed(0) + " MB";
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + " KB";
  return bytes + " B";
}

function humanAge(days) {
  if (!isFinite(days)) return "unknown";
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return days + " days ago";
  if (days < 365) return Math.round(days / 30) + " months ago";
  return (days / 365).toFixed(1) + " years ago";
}

function bar(fraction, width) {
  const filled = Math.max(1, Math.round(fraction * width));
  return "█".repeat(filled) + dim("─".repeat(Math.max(0, width - filled)));
}

function shortenPath(full, root) {
  const relative = path.relative(root, full).replace(/\\/g, "/");
  const text = relative || path.basename(full);
  return text.length <= 52 ? text : "..." + text.slice(-49);
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    usage();
    return 0;
  }

  if (!fs.existsSync(options.root)) {
    console.error(red("reclaim: " + options.root + " does not exist"));
    return 2;
  }

  const startedAt = Date.now();
  if (!options.json) {
    process.stdout.write(dim("  scanning " + options.root + " ...\r"));
  }

  const { results, directoriesSeen } = scan(options.root, { maxDepth: options.depth });

  let items = results;
  if (options.olderThan) items = olderThan(items, options.olderThan);
  if (options.minSize) items = items.filter((i) => i.bytes >= options.minSize * 1024 * 1024);

  const total = totalBytes(items);
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

  if (options.json) {
    console.log(JSON.stringify({
      root: options.root,
      scannedDirectories: directoriesSeen,
      totalBytes: total,
      items: items.map((i) => ({
        path: i.path,
        name: i.name,
        ecosystem: i.ecosystem,
        bytes: i.bytes,
        files: i.files,
        daysSinceTouched: daysSince(i.lastTouched),
      })),
    }, null, 2));
    return 0;
  }

  process.stdout.write(" ".repeat(70) + "\r");

  if (!items.length) {
    console.log("");
    console.log("  " + green("nothing to reclaim") +
      dim("  (" + directoriesSeen.toLocaleString("en-US") + " directories in " + seconds + "s)"));
    console.log("");
    return 0;
  }

  const biggest = items[0].bytes || 1;

  console.log("");
  console.log("  " + bold(humanSize(total)) + " can be reclaimed" +
    dim("  in " + items.length + " folder" + (items.length === 1 ? "" : "s") +
      ", scanned " + directoriesSeen.toLocaleString("en-US") + " directories in " + seconds + "s"));
  console.log("");

  const shown = items.slice(0, options.top);
  for (const item of shown) {
    const age = daysSince(item.lastTouched);
    const ageText = humanAge(age);
    const ageColor = age >= 180 ? red : age >= 60 ? yellow : dim;

    console.log(
      "  " + cyan(bar(item.bytes / biggest, 14)) + "  " +
      bold(humanSize(item.bytes).padStart(8)) + "  " +
      shortenPath(item.path, options.root)
    );
    console.log(
      "  " + " ".repeat(16) + dim(item.ecosystem) + dim("  -  ") +
      ageColor("last touched " + ageText) +
      dim("  -  " + item.files.toLocaleString("en-US") + " files")
    );
  }

  if (items.length > shown.length) {
    console.log("");
    console.log(dim("  ... and " + (items.length - shown.length) + " more (--all to see them)"));
  }

  const stale = olderThan(items, 90);
  if (stale.length && !options.olderThan) {
    console.log("");
    console.log("  " + violet(humanSize(totalBytes(stale))) +
      " of that has not been touched in 90 days" +
      dim("  (--older-than 90 --delete)"));
  }

  console.log("");

  if (!options.delete) {
    console.log(dim("  nothing was deleted. add --delete to remove these."));
    console.log(dim("  every folder above can be rebuilt: " + shown[0].rebuild));
    console.log("");
    return 0;
  }

  // ---- deletion path ----

  const removable = [];
  const blocked = [];
  for (const item of items) {
    const verdict = canRemove(item, options.root);
    if (verdict.ok) removable.push(item);
    else blocked.push({ item, reason: verdict.reason });
  }

  for (const entry of blocked) {
    console.log("  " + yellow("skipping ") + shortenPath(entry.item.path, options.root) +
      dim("  " + entry.reason));
  }

  if (!removable.length) {
    console.log("  " + yellow("nothing left to delete after the safety checks"));
    return 0;
  }

  if (!options.yes) {
    const answer = await ask(
      "  delete " + removable.length + " folders and free " +
      humanSize(totalBytes(removable)) + "?  type yes: "
    );
    if (answer !== "yes" && answer !== "y") {
      console.log("  " + dim("cancelled, nothing was deleted"));
      console.log("");
      return 0;
    }
  }

  const outcome = removeAll(removable, options.root);

  console.log("");
  console.log("  " + green(humanSize(outcome.freed) + " freed") +
    dim("  " + outcome.removed + " folders removed"));
  for (const skipped of outcome.skipped) {
    console.log("  " + yellow("could not remove ") + skipped.path + dim("  " + skipped.reason));
  }
  console.log("");

  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(red("reclaim: " + (err && err.message ? err.message : String(err))));
    process.exit(2);
  }
);
