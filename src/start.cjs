"use strict";

/**
 * Locates dist/server.js by walking up from __dirname/cwd.
 * Does not rely on package.json (Render may use nested src/ or duplicate paths).
 */
const path = require("path");
const fs = require("fs");

function findDistServer(startDir) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 16; i++) {
    const candidate = path.join(dir, "dist", "server.js");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const distServer =
  findDistServer(__dirname) ||
  findDistServer(process.cwd()) ||
  null;

if (!distServer) {
  console.error("Could not find dist/server.js; walked up from __dirname and cwd.");
  console.error("__dirname:", __dirname, "cwd:", process.cwd());
  console.error("Run `npm run build` so tsc emits dist/server.js at the repo root.");
  process.exit(1);
}

require(distServer);
