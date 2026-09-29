/*
 * Walking the tree and measuring what can be reclaimed.
 *
 * Two rules keep this honest:
 *   - a match is never entered. Once "node_modules" is found we measure it and
 *     stop, so a nested node_modules is counted once, inside its parent.
 *   - symbolic links are never followed. Following them is how a cleaner ends
 *     up deleting something outside the folder you pointed it at.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { candidatesFor, isTargetName, NEVER } = require("./targets");

const SKIP_ALWAYS = new Set([".git", ".svn", ".hg", "$RECYCLE.BIN", "System Volume Information"]);

/** Recursive size in bytes plus a file count. Never follows links. */
function measure(dir, budget) {
  let bytes = 0;
  let files = 0;
  const stack = [dir];

  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (err) {
      continue; // permission denied, or it vanished mid-scan
    }

    for (const entry of entries) {
      const full = path.join(current, entry.name);

      if (entry.isSymbolicLink()) continue;

      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }

      if (!entry.isFile()) continue;

      try {
        const stat = fs.lstatSync(full);
        bytes += stat.size;
        files++;
      } catch (err) {
        /* gone or unreadable, skip */
      }

      if (budget && files > budget) return { bytes, files, truncated: true };
    }
  }

  return { bytes, files, truncated: false };
}

/** The most recent mtime in a directory tree, sampled cheaply. */
function lastTouched(dir) {
  let newest = 0;
  const stack = [dir];
  let looked = 0;

  while (stack.length && looked < 400) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (err) {
      continue;
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(current, entry.name);
      looked++;
      try {
        const stat = fs.lstatSync(full);
        if (stat.mtimeMs > newest) newest = stat.mtimeMs;
        if (entry.isDirectory() && stack.length < 40) stack.push(full);
      } catch (err) {
        /* skip */
      }
    }
  }

  return newest;
}

function hasAnyMarker(dir, markers) {
  if (!markers) return true;
  return markers.some((marker) => {
    try {
      return fs.existsSync(path.join(dir, marker));
    } catch (err) {
      return false;
    }
  });
}

/** The project a build artifact belongs to: its parent directory. */
function projectOf(artifactPath) {
  return path.dirname(artifactPath);
}

/**
 * Scans `root` and returns every reclaimable directory found.
 *
 * options:
 *   maxDepth   how deep to walk (default 8)
 *   onProgress called with the directory currently being walked
 */
function scan(root, options) {
  const opts = options || {};
  const maxDepth = opts.maxDepth || 8;
  const results = [];
  const stack = [{ dir: path.resolve(root), depth: 0 }];
  let directoriesSeen = 0;

  while (stack.length) {
    const { dir, depth } = stack.pop();
    directoriesSeen++;

    if (opts.onProgress && directoriesSeen % 40 === 0) opts.onProgress(dir, results.length);

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;

      const name = entry.name;
      const full = path.join(dir, name);

      if (SKIP_ALWAYS.has(name)) continue;

      if (isTargetName(name) && !NEVER.has(name)) {
        const match = candidatesFor(name).find((target) => hasAnyMarker(dir, target.marker));

        if (match) {
          const size = measure(full);
          results.push({
            path: full,
            name,
            ecosystem: match.ecosystem,
            rebuild: match.rebuild,
            project: projectOf(full),
            bytes: size.bytes,
            files: size.files,
            lastTouched: lastTouched(full),
          });
          // do not descend into something we already counted whole
          continue;
        }
      }

      if (depth < maxDepth) stack.push({ dir: full, depth: depth + 1 });
    }
  }

  results.sort((a, b) => b.bytes - a.bytes);
  return { results, directoriesSeen };
}

function totalBytes(results) {
  return results.reduce((sum, item) => sum + item.bytes, 0);
}

function daysSince(ms) {
  if (!ms) return Infinity;
  return Math.floor((Date.now() - ms) / 86400000);
}

function olderThan(results, days) {
  return results.filter((item) => daysSince(item.lastTouched) >= days);
}

module.exports = { scan, measure, lastTouched, totalBytes, daysSince, olderThan, projectOf };
