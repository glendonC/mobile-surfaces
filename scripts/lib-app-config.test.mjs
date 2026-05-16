// Unit tests for the shared app.json parsing in scripts/lib/app-config.mjs.
// Both scripts/doctor.mjs and scripts/probe-app-config.mjs route through this
// module, so the access paths for App Groups, deployment target, etc. only
// have to be right in one place. These tests pin the contract.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadAppJson,
  readAppGroups,
  readDeploymentTarget,
  readAppleTeamId,
} from "./lib/app-config.mjs";

function withTmpAppJson(contents) {
  const dir = mkdtempSync(join(tmpdir(), "ms-app-config-"));
  const path = join(dir, "app.json");
  if (contents !== null) {
    writeFileSync(path, contents);
  }
  return {
    path,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test("loadAppJson returns missing when the file does not exist", () => {
  const ws = withTmpAppJson(null);
  try {
    const result = loadAppJson(ws.path);
    assert.equal(result.status, "missing");
    assert.equal(result.path, ws.path);
  } finally {
    ws.cleanup();
  }
});

test("loadAppJson returns invalid on malformed JSON", () => {
  const ws = withTmpAppJson("{ not valid json");
  try {
    const result = loadAppJson(ws.path);
    assert.equal(result.status, "invalid");
    assert.ok(typeof result.error === "string" && result.error.length > 0);
  } finally {
    ws.cleanup();
  }
});

test("loadAppJson returns ok with the parsed contents on the happy path", () => {
  const ws = withTmpAppJson(
    JSON.stringify({
      expo: {
        ios: {
          appleTeamId: "ABC1234567",
          deploymentTarget: "17.2",
          entitlements: {
            "com.apple.security.application-groups": [
              "group.com.example.mobilesurfaces",
            ],
          },
        },
      },
    }),
  );
  try {
    const result = loadAppJson(ws.path);
    assert.equal(result.status, "ok");
    assert.equal(result.appJson.expo.ios.appleTeamId, "ABC1234567");
  } finally {
    ws.cleanup();
  }
});

test("readAppGroups returns declared=true when the entitlement is a non-empty array", () => {
  const result = readAppGroups({
    expo: {
      ios: {
        entitlements: {
          "com.apple.security.application-groups": [
            "group.com.example.mobilesurfaces",
          ],
        },
      },
    },
  });
  assert.equal(result.declared, true);
  assert.deepEqual(result.groups, ["group.com.example.mobilesurfaces"]);
});

test("readAppGroups returns declared=false when entitlements are missing", () => {
  assert.deepEqual(readAppGroups({}), { declared: false, groups: [] });
  assert.deepEqual(readAppGroups({ expo: {} }), {
    declared: false,
    groups: [],
  });
  assert.deepEqual(readAppGroups({ expo: { ios: { entitlements: {} } } }), {
    declared: false,
    groups: [],
  });
});

test("readAppGroups returns declared=false when the entitlement is an empty array", () => {
  const result = readAppGroups({
    expo: {
      ios: {
        entitlements: {
          "com.apple.security.application-groups": [],
        },
      },
    },
  });
  assert.equal(result.declared, false);
  assert.deepEqual(result.groups, []);
});

test("readDeploymentTarget prefers explicit expo.ios.deploymentTarget", () => {
  const result = readDeploymentTarget({
    expo: {
      ios: { deploymentTarget: "17.2" },
      plugins: [
        ["expo-build-properties", { ios: { deploymentTarget: "16.0" } }],
      ],
    },
  });
  assert.equal(result.effective, "17.2");
  assert.equal(result.explicit, "17.2");
  assert.equal(result.fromBuildProps, "16.0");
});

test("readDeploymentTarget falls back to expo-build-properties", () => {
  const result = readDeploymentTarget({
    expo: {
      plugins: [
        ["expo-build-properties", { ios: { deploymentTarget: "17.2" } }],
      ],
    },
  });
  assert.equal(result.effective, "17.2");
  assert.equal(result.explicit, null);
  assert.equal(result.fromBuildProps, "17.2");
});

test("readDeploymentTarget returns null when missing from both sources", () => {
  const result = readDeploymentTarget({ expo: {} });
  assert.equal(result.effective, null);
  assert.equal(result.explicit, null);
  assert.equal(result.fromBuildProps, null);
});

test("readDeploymentTarget tolerates plugins entries that aren't expo-build-properties", () => {
  const result = readDeploymentTarget({
    expo: {
      ios: { deploymentTarget: "17.2" },
      plugins: ["some-plugin", ["another-plugin", { foo: "bar" }]],
    },
  });
  assert.equal(result.effective, "17.2");
});

test("readAppleTeamId returns the configured team id or empty string", () => {
  assert.equal(
    readAppleTeamId({ expo: { ios: { appleTeamId: "ABC1234567" } } }),
    "ABC1234567",
  );
  assert.equal(readAppleTeamId({}), "");
  assert.equal(readAppleTeamId({ expo: { ios: {} } }), "");
});
