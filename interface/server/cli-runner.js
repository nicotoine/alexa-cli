// How the interface runs alexa-cli. Two runners with the same shape — run, snapshot, login, session:
//
//   - subprocess (a computer): each call starts bin/alexa-cli.js, as a person would in a terminal;
//   - in-process (the Android app): calls main() directly. A phone has no `node` binary to start — nodejs-mobile
//     runs inside the app — and keeping one Amazon connection open between calls makes every action faster.
//
// Both run one command at a time: concurrent runs could each refresh the Amazon session and rewrite the stored
// tokens over one another.

import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadAuth } from '../../src/auth.js';
import { main } from '../../src/cli.js';
import { connect as connectToAlexa } from '../../src/client.js';

export const CLI = fileURLToPath(new URL('../../bin/alexa-cli.js', import.meta.url));
const TIMEOUT_MS = 180000;
// What says the session is gone: the next call then logs in again instead of reusing a dead connection.
const SESSION_LOST = /not logged in|401|Unauthorized|Cookie invalid/i;

function createQueue() {
    let queue = Promise.resolve();
    return (job) => {
        const done = queue.then(job);
        queue = done.catch(() => {});
        return done;
    };
}

function parseDocument(stdout, code, stderr) {
    let doc = null;
    try {
        doc = JSON.parse(stdout);
    } catch {
        // Not a document: the command died before printing one.
    }
    return { ok: code === 0, code, doc, error: code ? (doc && doc.error) || String(stderr).trim().replace(/^error: /, '') || `exit ${code}` : null };
}

// Splits what a command writes into lines, as they come.
function lineSink(onLine) {
    let pending = '';
    return {
        isTTY: false,
        write(chunk) {
            pending += chunk;
            let nl;
            while ((nl = pending.indexOf('\n')) >= 0) {
                const line = pending.slice(0, nl).trim();
                pending = pending.slice(nl + 1);
                if (line) onLine(line);
            }
            return true;
        },
    };
}

function textSink() {
    const sink = { isTTY: false, text: '', write: (s) => { sink.text += s; return true; } };
    return sink;
}

// ---- a computer: one process per call ---------------------------------------------------------------------

export function createSubprocessRunner({ cli = CLI, node = process.execPath } = {}) {
    const enqueue = createQueue();
    let login = null;

    return {
        run(argv) {
            return enqueue(() => new Promise((resolve) => {
                execFile(node, [cli, ...argv], { timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
                    resolve(parseDocument(stdout, err ? (typeof err.code === 'number' ? err.code : 1) : 0, stderr));
                });
            }));
        },

        snapshot(onLine) {
            let child = null;
            let aborted = false;
            const done = enqueue(() => new Promise((resolve) => {
                if (aborted) return resolve({ ok: false, aborted: true });
                child = spawn(node, [cli, 'snapshot'], { stdio: ['ignore', 'pipe', 'pipe'] });
                const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
                const sink = lineSink(onLine);
                let stderr = '';
                child.stdout.setEncoding('utf8');
                child.stdout.on('data', (chunk) => sink.write(chunk));
                child.stderr.on('data', (c) => { stderr += c; });
                child.on('close', (code) => {
                    clearTimeout(timer);
                    resolve({ ok: code === 0, error: code ? stderr.trim().replace(/^error: /, '') || `exit ${code}` : null });
                });
            }));
            return { done, abort: () => { aborted = true; if (child) child.kill(); } };
        },

        /** Starts `alexa-cli login`; resolves with the local page to sign in on, once the CLI prints it. */
        login() {
            if (login) return login.url;
            const child = spawn(node, [cli, 'login'], { stdio: ['ignore', 'pipe', 'pipe'] });
            login = { child };
            login.url = new Promise((resolve, reject) => {
                let stderr = '';
                child.stderr.setEncoding('utf8');
                child.stderr.on('data', (chunk) => {
                    stderr += chunk;
                    const url = stderr.match(/Open (http:\/\/127\.0\.0\.1:\d+\/)/);
                    if (url) resolve({ url: url[1] });
                });
                child.on('close', (code) => {
                    login = null;
                    if (code === 0) resolve({ loggedIn: true });
                    else reject(new Error(stderr.trim().replace(/^error: /, '') || `login exited with ${code}`));
                });
            });
            return login.url;
        },

        async session() {
            const status = await this.run(['status', '--json']);
            return { stored: Boolean(status.doc && status.doc.stored), valid: status.ok, loggingIn: Boolean(login) };
        },
    };
}

// ---- the Android app: main() in this process, one connection kept open ------------------------------------

export function createInProcessRunner({ connect = connectToAlexa, run = main } = {}) {
    const enqueue = createQueue();
    let client = null;
    let login = null;

    const connectFn = () => {
        client = client || connect({}).catch((e) => {
            client = null;
            throw e;
        });
        return client;
    };

    const invoke = async (argv, stdout) => {
        const stderr = textSink();
        const code = await run(argv, { stdout, stderr, connectFn });
        if (code && SESSION_LOST.test(stderr.text + (stdout.text || ''))) client = null;
        return { code, stderr: stderr.text };
    };

    return {
        run(argv) {
            return enqueue(async () => {
                const stdout = textSink();
                const { code, stderr } = await invoke(argv, stdout);
                return parseDocument(stdout.text, code, stderr);
            });
        },

        snapshot(onLine) {
            let aborted = false;
            const done = enqueue(async () => {
                if (aborted) return { ok: false, aborted: true };
                const { code, stderr } = await invoke(['snapshot'], lineSink((line) => { if (!aborted) onLine(line); }));
                return { ok: code === 0, error: code ? stderr.trim().replace(/^error: /, '') || `exit ${code}` : null };
            });
            return { done, abort: () => { aborted = true; } };
        },

        /**
         * Starts the Amazon login proxy (127.0.0.1:3456) in this process; resolves with its address, or with
         * { loggedIn: true } when the stored session is still accepted. Once Amazon accepts the login, the new
         * connection is the one every later call uses.
         */
        login() {
            if (login) return login;
            login = new Promise((resolve, reject) => {
                connect({ interactive: true, onLoginUrl: (url) => resolve({ url }) }).then((c) => {
                    client = Promise.resolve(c);
                    login = null;
                    resolve({ loggedIn: true });
                }, (e) => {
                    login = null;
                    reject(e);
                });
            });
            return login;
        },

        async session() {
            // While a login is under way, asking must not start a second connection racing it.
            if (login) return { stored: Boolean(loadAuth()), valid: false, loggingIn: true };
            const stored = Boolean(loadAuth());
            let valid = false;
            if (stored) {
                try {
                    await connectFn();
                    valid = true;
                } catch {
                    valid = false;
                }
            }
            return { stored, valid, loggingIn: false };
        },
    };
}

/** The runner for this machine: in-process when asked (the Android app sets it), a subprocess otherwise. */
export function createRunner(options = {}) {
    return process.env.ALEXA_CLI_RUNNER === 'inprocess' ? createInProcessRunner(options) : createSubprocessRunner(options);
}
