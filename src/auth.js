// Where the Amazon tokens live. Only what alexa-remote2 hands back after a login is kept — never a password —
// in a file only the user can read.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PROXY_PORT = 3456;

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * The page the login proxy shows once Amazon has accepted the login. With `returnTo` (the interface sets
 * ALEXA_CLI_RETURN_TO to its own address) it goes back there by itself: in the Android app the login replaces the
 * interface's page, and nothing else would bring it back.
 */
export function loginDoneHtml(returnTo = process.env.ALEXA_CLI_RETURN_TO) {
    const head = '<!doctype html><html lang="fr"><head><meta charset="utf-8">'
        + '<meta name="viewport" content="width=device-width, initial-scale=1"><title>Connecté à Amazon</title>';
    const body = '<body style="font-family: system-ui, sans-serif; text-align: center; padding: 48px 16px">'
        + '<p style="font-size: 1.2em"><b>Connecté à Amazon.</b></p>';
    if (!returnTo) return `${head}</head>${body}<p>Tu peux fermer cet onglet.</p></body></html>`;
    const url = escapeHtml(returnTo);
    return `${head}<meta http-equiv="refresh" content="1; url=${url}"></head>${body}`
        + `<p>Retour à l'interface… <a href="${url}">continuer</a></p></body></html>`;
}

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
