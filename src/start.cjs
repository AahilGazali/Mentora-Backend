"use strict";

/**
 * Render may set Root Directory to `src`, so `node dist/server.js` wrongly resolves to
 * `src/dist/server.js`. This file always loads the compiled server from the repo root `dist/`.
 */
const path = require("path");
const fs = require("fs");

const distServer = path.join(__dirname, "..", "dist", "server.js");
if (!fs.existsSync(distServer)) {
  console.error("Missing compiled output at:", distServer);
  console.error("Run `npm run build` from the repository root.");
  process.exit(1);
}

require(distServer);
