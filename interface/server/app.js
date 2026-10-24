// The interface's HTTP routes. Everything the page can do goes through the CLI runner; this file only decides who
// may ask and what may be asked.
//
//   GET  /api/snapshot     every list, as JSON lines streamed as they arrive (a cached copy first)
//   POST /api/do/<command> one change, dry run unless {"apply": true}; answers the CLI's --json document
//   GET  /api/session      whether a session is stored and accepted
//   GET  /api/journal      the latest changes the interface applied, newest first
//   POST /api/login        starts the Amazon login; answers the local page to sign in on
//   GET  /…                the page (interface/public)

import fs from 'node:fs';
import path from 'node:path';
import * as journal from './journal.js';
import { BadRequest, writeArgv } from './writes.js';

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
};
const MAX_BODY = 64 * 1024;

const SECURITY_HEADERS = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    // Ionic injects its component styles at run time, hence 'unsafe-inline' for styles; scripts stay 'self' only.
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; frame-ancestors 'none'",
};

export function createApp({ runner, publicDir, host, port, journalOptions = {} }) {
    // Last line received for each part of the snapshot, sent first so a new page renders at once.
    const cache = new Map();

    const send = (res, status, body, type = 'application/json; charset=utf-8') => {
        res.writeHead(status, { 'Content-Type': type, ...SECURITY_HEADERS });
        res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    };

    const readBody = (req) => new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (c) => {
            size += c.length;
            if (size > MAX_BODY) {
                reject(new BadRequest('body too large'));
                req.destroy();
            } else chunks.push(c);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });

    function snapshot(req, res) {
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', ...SECURITY_HEADERS });
        for (const line of cache.values()) res.write(`${JSON.stringify({ ...JSON.parse(line), cached: true })}\n`);
        const run = runner.snapshot((line) => {
            let kind;
            try {
                ({ kind } = JSON.parse(line));
            } catch {
                return;
            }
            if (kind !== 'error') cache.set(kind, line);
            res.write(`${line}\n`);
        });
        req.on('close', run.abort);
        run.done.then((result) => {
            if (!result.ok && !result.aborted) res.write(`${JSON.stringify({ kind: 'error', data: { kind: 'snapshot', message: result.error } })}\n`);
            res.end();
        });
    }

    // A custom header and a JSON body: a page on another site cannot send this without a CORS preflight, which this
    // server never answers.
    const trusted = (req) => req.headers['x-alexa-cli'] === '1' && String(req.headers['content-type']).startsWith('application/json');

    async function login(req, res) {
        if (!trusted(req)) return send(res, 403, { error: 'forbidden' });
        try {
            const started = await runner.login();
            // A new session: the lists cached for the old one must not be shown first any more.
            if (started.loggedIn) cache.clear();
            return send(res, 200, started);
        } catch (e) {
            return send(res, 502, { error: e.message });
        }
    }

    async function change(req, res, command) {
        if (!trusted(req)) return send(res, 403, { error: 'forbidden' });
        let argv;
        try {
            argv = writeArgv(command, JSON.parse((await readBody(req)) || '{}'));
        } catch (e) {
            return send(res, 400, { error: e instanceof SyntaxError ? 'invalid JSON' : e.message });
        }
        const result = await runner.run(argv);
        if (argv.includes('--apply') || command === 'run') {
            journal.record({
                command,
                target: argv[1] && !argv[1].startsWith('--') ? argv[1] : null,
                ok: result.ok,
                plan: (result.doc && result.doc.plan) || null,
                message: (result.doc && result.doc.message) || null,
                error: result.ok ? null : result.error,
            }, journalOptions);
        }
        // The CLI's own failures (a refused phrase, a session to renew) are 422 with its message; the page shows it.
        return send(res, result.ok ? 200 : 422, result.ok ? result.doc : { error: result.error });
    }

    function file(res, pathname) {
        const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
        const target = path.join(publicDir, path.normalize(rel));
        if (!target.startsWith(publicDir + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
            return send(res, 404, 'not found', 'text/plain; charset=utf-8');
        }
        return send(res, 200, fs.readFileSync(target), TYPES[path.extname(target)] || 'application/octet-stream');
    }

    return async (req, res) => {
        // Only this machine, under its own name: a DNS-rebinding page pointing another name at 127.0.0.1 is refused.
        const hostHeader = req.headers.host || '';
        if (hostHeader !== `${host}:${port}` && hostHeader !== `localhost:${port}`) return send(res, 421, { error: 'wrong host' });
        const { pathname } = new URL(req.url, `http://${hostHeader}`);
        try {
            if (req.method === 'GET' && pathname === '/api/snapshot') return snapshot(req, res);
            if (req.method === 'GET' && pathname === '/api/session') return send(res, 200, await runner.session());
            if (req.method === 'GET' && pathname === '/api/journal') return send(res, 200, journal.read({ ...journalOptions, limit: 100 }));
            if (req.method === 'POST' && pathname === '/api/login') return await login(req, res);
            if (req.method === 'POST' && pathname.startsWith('/api/do/')) return await change(req, res, pathname.slice('/api/do/'.length));
            if (req.method === 'GET' && !pathname.startsWith('/api/')) return file(res, pathname);
            return send(res, pathname.startsWith('/api/') ? 404 : 405, { error: 'not found' });
        } catch (e) {
            return send(res, 500, { error: e.message });
        }
    };
}
