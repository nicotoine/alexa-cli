// Where the Amazon tokens live. Only what alexa-remote2 hands back after a login is kept — never a password —
// in a file only the user can read.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PROXY_PORT = 3456;

// ALEXA_CLI_CONFIG_DIR lets the tests (and a second account) use another directory.
export function configDir() {
    return process.env.ALEXA_CLI_CONFIG_DIR || path.join(os.homedir(), '.config', 'alexa-cli');
}

export function authFile() {
    return path.join(configDir(), 'auth.json');
}

export function loadAuth() {
    try {
        return JSON.parse(fs.readFileSync(authFile(), 'utf8'));
    } catch {
        return null;
    }
}

export function saveAuth(data) {
    fs.mkdirSync(configDir(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(authFile(), JSON.stringify(data), { mode: 0o600 });
    // writeFileSync keeps the mode of a file that already exists, so it is set again.
    fs.chmodSync(authFile(), 0o600);
}

export function clearAuth() {
    const existed = fs.existsSync(authFile());
    fs.rmSync(authFile(), { force: true });
    return existed;
}
