#!/usr/bin/env node
// The local web interface: `npm run ui`, then http://127.0.0.1:3457/. Listens on this machine only.
// The Android app starts it too (android/nodejs/main.js), with the in-process runner.

import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createRunner } from './cli-runner.js';

export const HOST = '127.0.0.1';
export const PORT = Number(process.env.ALEXA_CLI_UI_PORT || process.env.PORT) || 3457;
// The built app (npm run ui:build). index.html is what every page path falls back to.
const PUBLIC_DIR = fileURLToPath(new URL('../app/dist', import.meta.url));

/** Starts the interface; resolves with the server once it listens. */
export function start({ host = HOST, port = PORT, runner = createRunner(), publicDir = PUBLIC_DIR } = {}) {
    // The login proxy's last page comes back here (src/auth.js loginDoneHtml); a CLI login spawned by the
    // subprocess runner inherits it.
    process.env.ALEXA_CLI_RETURN_TO ||= `http://${host}:${port}/`;
    const server = http.createServer(createApp({ runner, publicDir, host, port }));
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => resolve(server));
    });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    await start();
    console.log(`alexa-cli interface: http://${HOST}:${PORT}/`);
}
