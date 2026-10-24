#!/usr/bin/env node
// The local web interface: `npm run ui`, then http://127.0.0.1:3457/. Listens on this machine only.
// The Android app starts it too (android/nodejs/main.js), with the in-process runner.

import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createRunner } from './cli-runner.js';

export const HOST = '127.0.0.1';
export const PORT = Number(process.env.ALEXA_CLI_UI_PORT || process.env.PORT) || 3457;
const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));

/** Starts the interface; resolves with the server once it listens. */
export function start({ host = HOST, port = PORT, runner = createRunner(), publicDir = PUBLIC_DIR } = {}) {
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
