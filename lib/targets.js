/*
 * What counts as a reclaimable build artifact.
 *
 * Every entry here is a directory that a tool can rebuild from the files you
 * actually keep in version control. Nothing on this list is source code, and
 * nothing on it is data you would miss - that rule is what makes deleting safe
 * enough to automate.
 *
 * `marker` is a file that must exist in the parent directory for the match to
 * count. Without it, a folder called "build" could be anybody's source folder;
 * with it, we know a real toolchain put it there.
 */
"use strict";

const TARGETS = [
  {
    dir: "node_modules",
    ecosystem: "node",
    marker: ["package.json"],
    rebuild: "npm install",
  },
  {
    dir: ".venv",
    ecosystem: "python",
    marker: null,
    rebuild: "python -m venv .venv && pip install -r requirements.txt",
  },
  {
    dir: "venv",
    ecosystem: "python",
    marker: ["requirements.txt", "pyproject.toml", "setup.py"],
    rebuild: "python -m venv venv && pip install -r requirements.txt",
  },
  {
    dir: "__pycache__",
    ecosystem: "python",
    marker: null,
    rebuild: "regenerated automatically on the next run",
  },
  {
    dir: ".pytest_cache",
    ecosystem: "python",
    marker: null,
    rebuild: "regenerated on the next test run",
  },
  {
    dir: ".mypy_cache",
    ecosystem: "python",
    marker: null,
    rebuild: "regenerated on the next type check",
  },
  {
    dir: "target",
    ecosystem: "rust",
    marker: ["Cargo.toml"],
    rebuild: "cargo build",
  },
  {
    dir: "build",
    ecosystem: "gradle / cmake",
    marker: ["build.gradle", "build.gradle.kts", "CMakeLists.txt", "pom.xml"],
    rebuild: "./gradlew build  (or your build command)",
  },
  {
    dir: ".gradle",
    ecosystem: "gradle",
    marker: ["build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"],
    rebuild: "regenerated on the next gradle run",
  },
  {
    dir: "dist",
    ecosystem: "node",
    marker: ["package.json"],
    rebuild: "npm run build",
  },
  {
    dir: ".next",
    ecosystem: "next.js",
    marker: ["package.json"],
    rebuild: "next build",
  },
  {
    dir: ".nuxt",
    ecosystem: "nuxt",
    marker: ["package.json"],
    rebuild: "nuxt build",
  },
  {
    dir: ".turbo",
    ecosystem: "turborepo",
    marker: ["package.json"],
    rebuild: "regenerated on the next turbo run",
  },
  {
    dir: ".parcel-cache",
    ecosystem: "parcel",
    marker: ["package.json"],
    rebuild: "regenerated on the next parcel build",
  },
  {
    dir: "coverage",
    ecosystem: "node",
    marker: ["package.json"],
    rebuild: "regenerated on the next test run",
  },
  {
    dir: "Pods",
    ecosystem: "cocoapods",
    marker: ["Podfile"],
    rebuild: "pod install",
  },
  {
    dir: ".dart_tool",
    ecosystem: "dart / flutter",
    marker: ["pubspec.yaml"],
    rebuild: "flutter pub get",
  },
  {
    dir: ".terraform",
    ecosystem: "terraform",
    marker: null,
    rebuild: "terraform init",
  },
  {
    dir: "vendor",
    ecosystem: "php / go",
    marker: ["composer.json", "go.mod"],
    rebuild: "composer install  (or go mod vendor)",
  },
  {
    dir: "DerivedData",
    ecosystem: "xcode",
    marker: null,
    rebuild: "rebuilt by Xcode",
  },
];

const BY_NAME = new Map();
for (const target of TARGETS) {
  if (!BY_NAME.has(target.dir)) BY_NAME.set(target.dir, []);
  BY_NAME.get(target.dir).push(target);
}

/** Directory names that can never be deleted, whatever else matches. */
const NEVER = new Set([
  ".git", ".svn", ".hg", "src", "lib", "app", "source", "docs", "test", "tests",
  "public", "assets", "static", "config", "scripts", "data",
]);

function candidatesFor(name) {
  return BY_NAME.get(name) || [];
}

function isTargetName(name) {
  return BY_NAME.has(name);
}

module.exports = { TARGETS, NEVER, candidatesFor, isTargetName };
