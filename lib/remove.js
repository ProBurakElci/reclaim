/*
 * Deletion, with the checks that make it boring.
 *
 * A cleaner only has to be wrong once to ruin somebody's week, so every path
 * is re-validated here even though the scanner already produced it: the list
 * could have been filtered, edited, or read from a file written an hour ago.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { isTargetName, candidatesFor, NEVER } = require("./targets");

/**
 * Re-checks that a toolchain really put this directory here.
 *
 * The scanner already did this, but canRemove cannot assume the list it is
 * handed came straight from the scanner: it may have been filtered, saved to
 * a file, or written by hand. A folder called "build" with no build tool next
 * to it is somebody's own work, and deleting it would be unforgivable.
 */
function markerPresent(target) {
  const parent = path.dirname(target);
  const name = path.basename(target);

  return candidatesFor(name).some((candidate) => {
    if (!candidate.marker) return true;
    return candidate.marker.some((marker) => {
      try {
        return fs.existsSync(path.join(parent, marker));
      } catch (err) {
        return false;
      }
    });
  });
}

/** Is `child` genuinely inside `parent` (and not the same path)? */
function isInside(parent, child) {
  const from = path.resolve(parent);
  const to = path.resolve(child);
  if (from === to) return false;
  const relative = path.relative(from, to);
  return !!relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isDangerousRoot(target) {
  const resolved = path.resolve(target);
  const parsed = path.parse(resolved);

  if (resolved === parsed.root) return true;              // C:\ or /
  if (resolved === path.resolve(os.homedir())) return true;
  if (resolved === path.resolve(os.tmpdir())) return true;

  // one level under the drive root is still too close to the bone
  const depth = resolved.split(/[\\/]/).filter(Boolean).length;
  return depth <= 1;
}

/**
 * Returns { ok: true } or { ok: false, reason } - never throws.
 * `root` is the directory the user pointed the scan at.
 */
function canRemove(item, root) {
  const target = path.resolve(item.path);

  if (!isTargetName(item.name)) return { ok: false, reason: "not a known build artifact" };
  if (NEVER.has(item.name)) return { ok: false, reason: "name is on the never-delete list" };
  if (path.basename(target) !== item.name) return { ok: false, reason: "path does not end with its own name" };
  if (isDangerousRoot(target)) return { ok: false, reason: "too close to a filesystem or home root" };
  if (!isInside(root, target)) return { ok: false, reason: "outside the directory that was scanned" };

  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (err) {
    return { ok: false, reason: "no longer exists" };
  }

  if (stat.isSymbolicLink()) return { ok: false, reason: "is a symbolic link" };
  if (!stat.isDirectory()) return { ok: false, reason: "is not a directory" };

  if (!markerPresent(target)) {
    return { ok: false, reason: "no build tool next to it, so this is not a build output" };
  }

  // A build artifact never contains its own repository.
  try {
    if (fs.existsSync(path.join(target, ".git"))) {
      return { ok: false, reason: "contains a .git directory" };
    }
  } catch (err) {
    /* unreadable, fall through to the attempt */
  }

  return { ok: true };
}

/**
 * Deletes one artifact after re-checking it.
 * Returns { removed, bytes, reason }.
 */
function remove(item, root) {
  const verdict = canRemove(item, root);
  if (!verdict.ok) return { removed: false, bytes: 0, reason: verdict.reason };

  try {
    fs.rmSync(item.path, { recursive: true, force: true, maxRetries: 2, retryDelay: 120 });
  } catch (err) {
    return { removed: false, bytes: 0, reason: err.code || err.message };
  }

  return { removed: true, bytes: item.bytes, reason: null };
}

function removeAll(items, root) {
  const outcome = { removed: 0, freed: 0, skipped: [] };

  for (const item of items) {
    const result = remove(item, root);
    if (result.removed) {
      outcome.removed++;
      outcome.freed += result.bytes;
    } else {
      outcome.skipped.push({ path: item.path, reason: result.reason });
    }
  }

  return outcome;
}

module.exports = { canRemove, remove, removeAll, isInside, isDangerousRoot, markerPresent };
