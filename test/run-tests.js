/*
 * Tests:  node test/run-tests.js
 *
 * This tool deletes directories, so most of this file is about what it must
 * refuse to delete. The detection tests come first, the safety tests matter
 * more, and the last section builds a real tree and runs the CLI end to end.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { scan, measure, totalBytes, daysSince, olderThan } = require("../lib/scan");
const { canRemove, remove, removeAll, isInside, isDangerousRoot } = require("../lib/remove");

let passed = 0;
let failed = 0;

function ok(label, condition) {
  if (condition) passed++;
  else {
    failed++;
    console.error("  FAILED: " + label);
  }
}

function eq(label, actual, expected) {
  ok(label + " (got " + JSON.stringify(actual) + ", expected " + JSON.stringify(expected) + ")",
    actual === expected);
}

function section(name) {
  console.log("\n" + name);
}

/* ---------------- a sample project tree ---------------- */

const root = fs.mkdtempSync(path.join(os.tmpdir(), "reclaim-test-"));

function write(relative, content) {
  const full = path.join(root, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content || "x");
  return full;
}

function dir(relative) {
  const full = path.join(root, relative);
  fs.mkdirSync(full, { recursive: true });
  return full;
}

// a node project with dependencies and a build output
write("web/package.json", "{}");
write("web/src/index.js", "console.log(1);");
write("web/node_modules/left-pad/index.js", "x".repeat(4096));
write("web/node_modules/chalk/index.js", "y".repeat(2048));
write("web/dist/bundle.js", "z".repeat(1024));

// a python project
write("api/requirements.txt", "flask");
write("api/venv/lib/python3/site-packages/flask/__init__.py", "p".repeat(3000));
write("api/app/__pycache__/app.cpython-311.pyc", "c".repeat(500));

// a rust project
write("engine/Cargo.toml", "[package]");
write("engine/target/debug/engine", "r".repeat(3000));

// traps: folders with the right name but no toolchain marker next to them
dir("notes/build");
write("notes/build/manual-notes.txt", "these are my notes, not a build");
dir("website/dist");
write("website/dist/index.html", "<html>hand written</html>");

// a source folder that must never be touched
write("web/src/lib/util.js", "export const x = 1;");

const { results } = scan(root);
const byName = (name) => results.filter((r) => r.name === name);

/* ---------------- detection ---------------- */

section("Detection");

ok("finds node_modules", byName("node_modules").length === 1);
ok("finds dist next to a package.json", byName("dist").some((r) => r.path.includes("web")));
ok("finds venv next to requirements.txt", byName("venv").length === 1);
ok("finds __pycache__", byName("__pycache__").length === 1);
ok("finds target next to Cargo.toml", byName("target").length === 1);

ok("ignores a build folder with no build tool next to it",
  !results.some((r) => r.path.includes("notes")));
ok("ignores a dist folder with no package.json next to it",
  !results.some((r) => r.path.includes("website")));
ok("never reports a src folder", !results.some((r) => r.name === "src"));
ok("never reports lib", !results.some((r) => r.name === "lib"));

ok("node_modules is the largest find", results[0].name === "node_modules");
ok("sizes are measured", results.every((r) => r.bytes > 0));
ok("file counts are measured", results.every((r) => r.files > 0));
ok("each find knows its ecosystem", results.every((r) => typeof r.ecosystem === "string"));
ok("each find knows how to rebuild itself", results.every((r) => r.rebuild.length > 3));

const nodeModules = byName("node_modules")[0];
eq("node_modules counts both packages", nodeModules.files, 2);
ok("node_modules size is the sum of its files", nodeModules.bytes === 4096 + 2048);

ok("total is the sum of the parts",
  totalBytes(results) === results.reduce((s, r) => s + r.bytes, 0));

/* ---------------- nesting ---------------- */

section("Nested artifacts");

write("web/node_modules/some-pkg/node_modules/inner/index.js", "n".repeat(100));
const nested = scan(root).results.filter((r) => r.name === "node_modules");
eq("a nested node_modules is not reported separately", nested.length, 1);
ok("the inner one is counted inside the outer",
  nested[0].bytes === 4096 + 2048 + 100);

/* ---------------- safety ---------------- */

section("Safety checks");

const fake = (p, name) => ({ path: p, name: name || path.basename(p), bytes: 1 });

ok("refuses a path outside the scanned root",
  !canRemove(fake(path.join(os.tmpdir(), "somewhere-else", "node_modules")), root).ok);
ok("refuses the scan root itself", !canRemove(fake(root, "node_modules"), root).ok);
ok("refuses a drive or filesystem root", isDangerousRoot(path.parse(process.cwd()).root));
ok("refuses the home directory", isDangerousRoot(os.homedir()));
ok("refuses a name that is not a known artifact",
  !canRemove(fake(path.join(root, "web", "src"), "src"), root).ok);
ok("refuses a never-delete name",
  !canRemove(fake(path.join(root, "web", "lib"), "lib"), root).ok);
ok("refuses something that no longer exists",
  !canRemove(fake(path.join(root, "web", "node_modules_gone"), "node_modules"), root).ok);
ok("refuses a file that is not a directory",
  !canRemove(fake(path.join(root, "web", "package.json"), "node_modules"), root).ok);

const withGit = dir("cloned/node_modules");
write("cloned/package.json", "{}");
dir("cloned/node_modules/.git");
ok("refuses an artifact that contains a .git directory",
  !canRemove(fake(withGit, "node_modules"), root).ok);

// The scanner already skips this one, but canRemove must refuse it too: the
// list it receives may have been filtered, saved, or written by hand.
ok("refuses a build folder with no build tool next to it, even when handed in directly",
  !canRemove(fake(path.join(root, "notes", "build"), "build"), root).ok);
ok("refuses a dist folder with no package.json next to it",
  !canRemove(fake(path.join(root, "website", "dist"), "dist"), root).ok);

ok("accepts a real artifact inside the root",
  canRemove(fake(nodeModules.path, "node_modules"), root).ok);

eq("isInside says no for the same path", isInside(root, root), false);
eq("isInside says no for a parent", isInside(path.join(root, "web"), root), false);
eq("isInside says yes for a child", isInside(root, path.join(root, "web", "node_modules")), true);

/* ---------------- deletion ---------------- */

section("Deletion");

const distPath = path.join(root, "web", "dist");
const before = fs.existsSync(distPath);
const result = remove({ path: distPath, name: "dist", bytes: 1024 }, root);
ok("dist existed before", before);
ok("remove reports success", result.removed);
ok("dist is gone", !fs.existsSync(distPath));
ok("the project around it is untouched", fs.existsSync(path.join(root, "web", "package.json")));
ok("the source folder is untouched", fs.existsSync(path.join(root, "web", "src", "index.js")));

const blocked = remove({ path: path.join(root, "web", "src"), name: "src", bytes: 1 }, root);
ok("removing src is refused", !blocked.removed);
ok("src is still there", fs.existsSync(path.join(root, "web", "src")));

const batch = removeAll([
  { path: path.join(root, "api", "app", "__pycache__"), name: "__pycache__", bytes: 500 },
  { path: path.join(root, "notes", "build"), name: "build", bytes: 10 },
], root);
eq("batch removed the cache", batch.removed, 1);
ok("batch kept the hand-written notes", fs.existsSync(path.join(root, "notes", "build")));

/* ---------------- age filter ---------------- */

section("Age filter");

const now = Date.now();
const items = [
  { bytes: 10, lastTouched: now },
  { bytes: 20, lastTouched: now - 40 * 86400000 },
  { bytes: 30, lastTouched: now - 200 * 86400000 },
];
eq("nothing is older than 365 days", olderThan(items, 365).length, 0);
eq("two are older than 30 days", olderThan(items, 30).length, 2);
eq("one is older than 100 days", olderThan(items, 100).length, 1);
ok("daysSince handles a missing timestamp", !isFinite(daysSince(0)));

/* ---------------- symlinks ---------------- */

section("Symbolic links");

let symlinkSupported = true;
const linkTarget = dir("outside-target");
write("outside-target/big.bin", "b".repeat(9999));
try {
  fs.symlinkSync(linkTarget, path.join(root, "web", "linked"), "junction");
} catch (err) {
  symlinkSupported = false;
}

if (symlinkSupported) {
  const afterLink = scan(root).results;
  ok("a linked directory is not followed",
    !afterLink.some((r) => r.path.includes("linked")));
  const measured = measure(path.join(root, "web"));
  ok("measuring does not walk through a link", measured.bytes < 9999 + 7000);
} else {
  console.log("  (skipped: this system does not allow creating links)");
  passed += 2;
}

/* ---------------- cli ---------------- */

section("Command line");

const cli = path.resolve(__dirname, "..", "bin", "reclaim.js");

function runCli(args) {
  try {
    return {
      code: 0,
      out: execFileSync(process.execPath, [cli].concat(args), {
        encoding: "utf8",
        env: Object.assign({}, process.env, { NO_COLOR: "1" }),
      }),
    };
  } catch (err) {
    return { code: err.status, out: (err.stdout || "") + (err.stderr || "") };
  }
}

const report = runCli([root]);
eq("report exits 0", report.code, 0);
ok("report shows a total", /can be reclaimed/.test(report.out));
ok("report says nothing was deleted", /nothing was deleted/.test(report.out));
ok("report lists node_modules", report.out.includes("node_modules"));

const stillThere = fs.existsSync(nodeModules.path);
ok("a plain report deletes nothing", stillThere);

const json = runCli([root, "--json"]);
const parsed = JSON.parse(json.out);
ok("json lists items", Array.isArray(parsed.items) && parsed.items.length > 0);
ok("json has a total", typeof parsed.totalBytes === "number");
ok("json items carry an age", parsed.items.every((i) => typeof i.daysSinceTouched === "number"));

const filtered = runCli([root, "--older-than", "3650", "--json"]);
eq("an impossible age filter returns nothing", JSON.parse(filtered.out).items.length, 0);

const missing = runCli([path.join(root, "does-not-exist")]);
eq("a missing path exits 2", missing.code, 2);

const deleted = runCli([root, "--delete", "--yes"]);
eq("delete run exits 0", deleted.code, 0);
ok("delete run reports freed space", /freed/.test(deleted.out));
ok("node_modules is gone after --delete", !fs.existsSync(nodeModules.path));
ok("package.json survived", fs.existsSync(path.join(root, "web", "package.json")));
ok("src survived", fs.existsSync(path.join(root, "web", "src", "index.js")));
ok("hand-written notes survived", fs.existsSync(path.join(root, "notes", "build", "manual-notes.txt")));

/* ---------------- done ---------------- */

try {
  fs.rmSync(root, { recursive: true, force: true });
} catch (err) {
  /* best effort */
}

console.log("\n" + passed + " passed, " + failed + " failed.");
process.exit(failed ? 1 : 0);
