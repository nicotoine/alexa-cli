#!/usr/bin/env node
// The local web interface: `npm run ui`, then http://127.0.0.1:3457/. Listens on this machine only.

import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { createRunner } from './cli-runner.js';

const HOST = '127.0.0.1';
const PORT = Number(process.env.ALEXA_CLI_UI_PORT || process.env.PORT) || 3457;
const publicDir = fileURLToPath(new URL('../public', import.meta.url));

const server = http.createServer(createApp({ runner: createRunner(), publicDir, host: HOST, port: PORT }));
server.listen(PORT, HOST, () => console.log(`alexa-cli interface: http://${HOST}:${PORT}/`));
