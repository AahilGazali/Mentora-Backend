"use strict";

/**
 * Finds repo root via package.json, then loads dist/server.js.
 * Works regardless of Render root directory or where this file lives under src/.
 */
const path = require("path");
const fs = require("fs");

function findPackageRoot(startDir) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const root =
  findPackageRoot(__dirname) ||
  findPackageRoot(process.cwd()) ||
  path.join(__dirname, "..");

const distServer = path.join(root, "dist", "server.js");

if (!fs.existsSync(distServer)) {
  console.error("Missing compiled output at:", distServer);
  console.error("Resolved repo root:", root, "__dirname:", __dirname, "cwd:", process.cwd());
  console.error("Run `npm run build` from the repository root (where package.json is).");
  process.exit(1);
}

require(distServer);
