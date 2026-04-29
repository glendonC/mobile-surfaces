// Append-only log of every command we run and its stdout/stderr. Failure
// messages can cite this path so the user has somewhere concrete to look.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let _path = null;
let _stream = null;

export function open() {
  if (_stream) return { path: _path };

  const dir = path.join(os.homedir(), ".mobile-surfaces");
  fs.mkdirSync(dir, { recursive: true });
  _path = path.join(dir, "last-install.log");
  _stream = fs.createWriteStream(_path, { flags: "w" });

  const stamp = new Date().toISOString();
  _stream.write(`# create-mobile-surfaces install log\n# started ${stamp}\n\n`);
  return { path: _path };
}

export function write(text) {
  if (!_stream) open();
  _stream.write(text);
}

export function header(label) {
  write(`\n=== ${label} ===\n`);
}

export function getPath() {
  return _path;
}
