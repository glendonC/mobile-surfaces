// Test fixture helper: generate a temporary ES256 .p8 (for JWT signing) on
// the fly. The TLS layer is bypassed for tests by spinning up an h2c
// (cleartext HTTP/2) server and pointing the client at `http://127.0.0.1:<port>`
// via TEST_TRANSPORT_OVERRIDE — no self-signed cert required.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function generateEs256Pem() {
  const { privateKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  return privateKey.export({ format: "pem", type: "pkcs8" }).toString();
}

export function writeTempP8(pem) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ms-push-"));
  const file = path.join(dir, "AuthKey.p8");
  fs.writeFileSync(file, pem);
  return {
    dir,
    file,
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    },
  };
}
