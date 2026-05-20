// CLI-logic regression test. Not snapshot-driven: the scaffold-snapshot test
// hashes file *contents* and excludes the CLI internals, so it cannot see a
// CLI-logic regression where a code path stops being reachable. This test
// reads src/ and bin/ statically and asserts the wiring holds:
//
//   1. Every exported apply* task has a call site outside its own
//      declaration, and its module is import-reachable from a mode runner.
//   2. Every validator imported into a prompt-defining file is wired into a
//      real prompt's `validate:` slot, and vice versa.
//   3. Every --flag in FLAG_OPTIONS is documented in HELP_TEXT and consumed
//      by the flag-parsing logic, and HELP_TEXT names no flag that
//      FLAG_OPTIONS does not declare.
//
// It is pure static analysis (read + regex), so it never spawns the CLI and
// stays fast. The point is to fail loudly when a refactor orphans a task,
// validator, or flag — the class of regression the file-hash snapshot is
// structurally blind to.

import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { FLAG_OPTIONS, HELP_TEXT } from "../src/flags.mjs";

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = path.join(PKG_ROOT, "src");
const BIN_ENTRY = path.join(PKG_ROOT, "bin", "index.mjs");

const SRC_FILES = fs
  .readdirSync(SRC_DIR)
  .filter((f) => f.endsWith(".mjs"))
  .map((f) => path.join(SRC_DIR, f));

function read(file) {
  return fs.readFileSync(file, "utf8");
}

// The three mode runners the bin dispatches to: greenfield, add-to-existing,
// and existing-monorepo. Every apply* task has to be reachable from one of
// them or it is dead code.
const MODE_RUNNERS = ["runTasks", "runExistingTasks", "runMonorepoTasks"];

describe("CLI logic: apply* tasks", () => {
  // Collect every `export ... function apply*` across src/.
  const applyExports = [];
  for (const file of SRC_FILES) {
    const src = read(file);
    const re = /export\s+(?:async\s+)?function\s+(apply[A-Za-z0-9]*)/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      applyExports.push({ name: m[1], file });
    }
  }

  it("finds the apply* task surface", () => {
    // Guard against the collector silently matching nothing (e.g. after a
    // rename of the apply* convention) and the suite passing vacuously.
    assert.ok(
      applyExports.length >= 5,
      `expected to find the apply* tasks, found ${applyExports.length}`,
    );
  });

  const allSource = [BIN_ENTRY, ...SRC_FILES].map(read).join("\n");

  for (const { name } of applyExports) {
    it(`${name} has a call site outside its declaration`, () => {
      const calls = (allSource.match(new RegExp(`\\b${name}\\(`, "g")) ?? [])
        .length;
      const declarations = (
        allSource.match(new RegExp(`function\\s+${name}\\(`, "g")) ?? []
      ).length;
      assert.ok(
        calls - declarations >= 1,
        `${name} is exported but never called — orphaned task`,
      );
    });
  }

  it("every apply* module is import-reachable from the bin entry", () => {
    // Build the module import graph and BFS from bin/index.mjs. A module that
    // declares an apply* task but is not in the closure is unreachable no
    // matter how its functions are referenced.
    const reachable = new Set();
    const queue = [BIN_ENTRY];
    while (queue.length > 0) {
      const file = queue.shift();
      if (reachable.has(file)) continue;
      reachable.add(file);
      const src = read(file);
      const importRe = /from\s+["'](\.[^"']+)["']/g;
      let m;
      while ((m = importRe.exec(src)) !== null) {
        let spec = m[1];
        if (!spec.endsWith(".mjs")) spec += ".mjs";
        const resolved = path.resolve(path.dirname(file), spec);
        if (fs.existsSync(resolved)) queue.push(resolved);
      }
    }
    for (const { name, file } of applyExports) {
      assert.ok(
        reachable.has(file),
        `${name} lives in ${path.basename(file)}, which the bin entry never imports`,
      );
    }
  });

  it("the bin entry dispatches to all three mode runners", () => {
    const bin = read(BIN_ENTRY);
    for (const runner of MODE_RUNNERS) {
      assert.ok(
        new RegExp(`\\b${runner}\\b`).test(bin),
        `bin/index.mjs never references mode runner ${runner}`,
      );
    }
  });
});

describe("CLI logic: prompt validators", () => {
  // Files that define interactive prompts. Each imports validators from
  // ./validators.mjs and wires them into prompt `validate:` slots.
  const PROMPT_FILES = ["prompts.mjs", "existing-expo.mjs", "existing-monorepo.mjs"];

  for (const fileName of PROMPT_FILES) {
    const file = path.join(SRC_DIR, fileName);
    const src = read(file);

    // Identifiers imported from ./validators.mjs that look like validators.
    const importedValidators = new Set();
    const importBlockRe = /import\s+(?:{([^}]*)}|(\w+))\s+from\s+["']\.\/validators\.mjs["']/g;
    let im;
    while ((im = importBlockRe.exec(src)) !== null) {
      const names = (im[1] ?? im[2] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      for (const n of names) {
        if (/^validate/.test(n)) importedValidators.add(n);
      }
    }

    // Identifiers used as a prompt `validate:` value.
    const wiredValidators = new Set();
    const wireRe = /validate:\s*([A-Za-z0-9_]+)/g;
    let wm;
    while ((wm = wireRe.exec(src)) !== null) {
      wiredValidators.add(wm[1]);
    }

    it(`${fileName}: every imported validator is wired into a prompt`, () => {
      for (const v of importedValidators) {
        assert.ok(
          wiredValidators.has(v),
          `${fileName} imports ${v} but never wires it into a prompt's validate: slot`,
        );
      }
    });

    it(`${fileName}: every wired validator is imported from validators.mjs`, () => {
      for (const v of wiredValidators) {
        assert.ok(
          importedValidators.has(v),
          `${fileName} wires ${v} into a prompt but does not import it from ./validators.mjs`,
        );
      }
    });
  }
});

describe("CLI logic: --flags", () => {
  const flagKeys = Object.keys(FLAG_OPTIONS);
  const flagsSource = read(path.join(SRC_DIR, "flags.mjs"));

  // Long flags named anywhere in HELP_TEXT. The exit-codes section carries
  // no `--`, so a plain scan is safe.
  const helpFlags = new Set(
    (HELP_TEXT.match(/--[a-z][a-z-]*/g) ?? []).map((f) => f.slice(2)),
  );

  it("finds the flag surface", () => {
    assert.ok(flagKeys.length >= 10, "expected FLAG_OPTIONS to be populated");
  });

  for (const key of flagKeys) {
    it(`--${key} is documented in HELP_TEXT`, () => {
      assert.ok(
        helpFlags.has(key),
        `--${key} is declared in FLAG_OPTIONS but absent from HELP_TEXT`,
      );
    });

    it(`--${key} is consumed by the flag-parsing logic`, () => {
      // Every flag is read off the parseArgs `values` object — either by
      // flagsToOverrides (most flags) or parseCliFlags directly (yes, help).
      const consumed =
        flagsSource.includes(`values.${key}`) ||
        flagsSource.includes(`values["${key}"]`) ||
        flagsSource.includes(`values['${key}']`);
      assert.ok(
        consumed,
        `--${key} is declared in FLAG_OPTIONS but never read from parseArgs values`,
      );
    });
  }

  it("HELP_TEXT names no flag that FLAG_OPTIONS does not declare", () => {
    for (const f of helpFlags) {
      assert.ok(
        flagKeys.includes(f),
        `HELP_TEXT documents --${f}, which FLAG_OPTIONS does not declare`,
      );
    }
  });
});
