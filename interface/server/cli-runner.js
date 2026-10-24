// Runs bin/alexa-cli.js for the interface, one at a time: concurrent runs could each refresh the Amazon session
// and rewrite the stored tokens over one another.

import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const CLI = fileURLToPath(new URL('../../bin/alexa-cli.js', import.meta.url));
const TIMEOUT_MS = 180000;

export function createRunner({ cli = CLI, node = process.execPath } = {}) {
    let queue = Promise.resolve();
    const enqueue = (job) => {
        const done = queue.then(job);
        queue = done.catch(() => {});
        return done;
    };

    return {
        /** One command; the answer is its --json document (or an error document). */
        run(argv) {
            return enqueue(() => new Promise((resolve) => {
                execFile(node, [cli, ...argv], { timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
                    let doc = null;
                    try {
                        doc = JSON.parse(stdout);
                    } catch {
                        // Not a document: the process died before printing one.
                    }
                    const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
                    resolve({ ok: code === 0, code, doc, error: code ? (doc && doc.error) || stderr.trim() || `exit ${code}` : null });
                });
            }));
        },

        /**
         * `snapshot`, line by line: `onLine(line)` for every JSON line as it arrives. Resolves when the CLI exits;
         * `abort()` stops it (the page went away).
         */
        snapshot(onLine) {
            let child = null;
            let aborted = false;
            const done = enqueue(() => new Promise((resolve) => {
                if (aborted) return resolve({ ok: false, aborted: true });
                child = spawn(node, [cli, 'snapshot'], { stdio: ['ignore', 'pipe', 'pipe'] });
                const timer = setTimeout(() => child.kill(), TIMEOUT_MS);
                let pending = '';
                let stderr = '';
                child.stdout.setEncoding('utf8');
                child.stdout.on('data', (chunk) => {
                    pending += chunk;
                    let nl;
                    while ((nl = pending.indexOf('\n')) >= 0) {
                        const line = pending.slice(0, nl).trim();
                        pending = pending.slice(nl + 1);
                        if (line) onLine(line);
                    }
                });
                child.stderr.on('data', (c) => { stderr += c; });
                child.on('close', (code) => {
                    clearTimeout(timer);
                    resolve({ ok: code === 0, error: code ? stderr.trim().replace(/^error: /, '') || `exit ${code}` : null });
                });
            }));
            return { done, abort: () => { aborted = true; if (child) child.kill(); } };
        },
    };
}
