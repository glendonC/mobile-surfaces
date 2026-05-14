// Drift guard for the two APNs reason tables.
//
// scripts/send-apns.mjs ships its own APNS_REASON_GUIDE so the CLI can print
// a fix without depending on a built @mobile-surfaces/push. packages/push has
// its own APNS_REASON_GUIDE for SDK consumers. The copy in each is written
// for a different audience and is allowed to diverge, but the SET of reason
// keys must not: a reason string added to one table and not the other is a
// silent gap where one surface explains an APNs failure and the other prints
// "not in the local guide".
//
// This test asserts the key sets are identical and that every entry is a
// well-formed { cause, fix } pair. Run with:
//   node --experimental-strip-types --no-warnings=ExperimentalWarning \
//     --test scripts/send-apns-reason-parity.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { APNS_REASON_GUIDE as scriptGuide } from "./send-apns.mjs";
import { APNS_REASON_GUIDE as packageGuide } from "../packages/push/src/reasons.ts";

test("send-apns.mjs and packages/push reason guides cover the same keys", () => {
  const scriptKeys = Object.keys(scriptGuide).sort();
  const packageKeys = Object.keys(packageGuide).sort();

  const onlyInScript = scriptKeys.filter((k) => !(k in packageGuide));
  const onlyInPackage = packageKeys.filter((k) => !(k in scriptGuide));

  assert.deepEqual(
    onlyInScript,
    [],
    `reasons in scripts/send-apns.mjs but not packages/push/src/reasons.ts: ${onlyInScript.join(", ")}. Add them to packages/push/src/reasons.ts or remove them from the script.`,
  );
  assert.deepEqual(
    onlyInPackage,
    [],
    `reasons in packages/push/src/reasons.ts but not scripts/send-apns.mjs: ${onlyInPackage.join(", ")}. Add them to APNS_REASON_GUIDE in scripts/send-apns.mjs (CLI-flavored copy) so the CLI does not print "not in the local guide" for a reason the SDK already documents.`,
  );
  assert.deepEqual(scriptKeys, packageKeys);
});

test("every script reason entry is a well-formed cause/fix pair", () => {
  for (const [key, entry] of Object.entries(scriptGuide)) {
    assert.equal(typeof entry.cause, "string", `${key}.cause must be a string`);
    assert.equal(typeof entry.fix, "string", `${key}.fix must be a string`);
    assert.ok(entry.cause.length > 0, `${key}.cause is empty`);
    assert.ok(entry.fix.length > 0, `${key}.fix is empty`);
  }
});
