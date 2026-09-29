# reclaim

[![tests](https://github.com/ProBurakElci/reclaim/actions/workflows/ci.yml/badge.svg)](https://github.com/ProBurakElci/reclaim/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Find the gigabytes your build tools left behind, then delete them safely.**

```bash
npx reclaim ~/code
```

Nothing is deleted unless you ask. The first run is always a report.

On my own machine, a single folder of Android projects was holding **2.6 GB** of `build` and `node_modules` directories — all of it rebuildable with one command.

## What a run looks like

```
  34 MB can be reclaimed  in 9 folders, scanned 12 directories in 0.0s

  ██████████████      9 MB  mobile-app/app/build
                  gradle / cmake  -  last touched today  -  1 files
  ████████████──      8 MB  shop-frontend/node_modules
                  node  -  last touched today  -  2 files
  ███████████───      7 MB  ml-notebooks/.venv
                  python  -  last touched today  -  1 files
  ██████────────      4 MB  api-service/node_modules
                  node  -  last touched today  -  1 files
  ████──────────      2 MB  mobile-app/.gradle
                  gradle  -  last touched today  -  1 files

  169 MB of that has not been touched in 90 days  (--older-than 90 --delete)

  nothing was deleted. add --delete to remove these.
```

Every row carries the thing you actually need to decide: how big it is, how long it has been untouched, and which toolchain will rebuild it.

## Usage

```bash
npx reclaim                      # report on the current folder
npx reclaim ~/code               # report on a folder
npx reclaim --older-than 90      # only what nothing has touched in 90 days
npx reclaim --min-size 100       # ignore anything under 100 MB
npx reclaim --all                # print every row, not just the top 15
npx reclaim --json               # machine-readable
npx reclaim --older-than 90 --delete    # delete, after typing "yes"
```

A good habit: run `--older-than 90 --delete` once a month. The stale projects give the space back and the ones you are actually working on stay untouched.

## What it looks for

| Ecosystem | Directories |
|---|---|
| Node | `node_modules`, `dist`, `.next`, `.nuxt`, `.turbo`, `.parcel-cache`, `coverage` |
| Python | `.venv`, `venv`, `__pycache__`, `.pytest_cache`, `.mypy_cache` |
| Rust | `target` |
| Gradle / CMake / Maven | `build`, `.gradle` |
| iOS / Xcode | `Pods`, `DerivedData` |
| Dart / Flutter | `.dart_tool` |
| PHP / Go | `vendor` |
| Terraform | `.terraform` |

## Why it is safe to point at your whole code folder

A cleaner only has to be wrong once, so the rules are strict:

- **A name is not enough.** `build` only counts when there is a `build.gradle`, `CMakeLists.txt` or `pom.xml` next to it. `dist` needs a `package.json`. `target` needs a `Cargo.toml`. Your hand-written `notes/build` folder is invisible to this tool.
- **The check runs twice.** The scanner verifies it, and the delete path verifies it again from scratch — because the list it is handed could have been filtered, saved to a file, or written by hand.
- **Symbolic links are never followed**, so a link cannot walk the deletion out of the folder you pointed at.
- **Nothing outside the scanned folder can be deleted**, and paths at or near a drive root or your home directory are refused outright.
- **A directory containing `.git` is never deleted** — that is a repository, not a build output.
- **Dry run is the default.** `--delete` still asks you to type `yes` unless you pass `--yes`.

The one thing it will not do is protect you from deleting something you genuinely wanted: if `node_modules` is gone, run `npm install`. That is the trade the whole tool is built on — it only ever removes what a command can recreate.

## Tests

```bash
node test/run-tests.js
```

65 checks. Detection (including a `build` folder with no build tool next to it, which must stay invisible), nested artifacts counted once, size and age measurement, symbolic links not being followed, and the safety rules — each refusal has its own test. The last section builds a real project tree, runs the CLI against it, deletes for real, and verifies that `package.json`, `src/` and a hand-written `notes/build` all survived.

One of those tests was written after it caught a genuine bug: the delete path checked the folder's *name* but not whether a toolchain had actually created it, so a hand-written `build` folder passed in directly would have been removed. It is checked in both places now.

## How it works

```
bin/reclaim.js     arguments, the report, the confirmation
lib/targets.js     what counts as an artifact, and the marker each one needs
lib/scan.js        the walk, sizes, and last-touched times
lib/remove.js      the safety checks and the deletion
```

The walk never descends into something it has already matched, so a `node_modules` inside a `node_modules` is counted once, inside its parent — which is what you want when the number on screen is supposed to mean "this much space comes back".

## Contributing

Adding an ecosystem is one entry in `lib/targets.js`: the directory name, the marker file that proves a toolchain put it there, and the command that rebuilds it. Add a detection test and, if the name could collide with someone's source folder, a test that it stays invisible without the marker.

## License

MIT — see [LICENSE](LICENSE).
