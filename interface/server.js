#!/usr/bin/env node
// Local web interface for alexa-cli. Every action runs ../cli.js (no shell, whitelisted commands), so the
// interface can do exactly what the CLI does and nothing more. Listens on 127.0.0.1 only.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 3457;
const CLI = path.join(__dirname, '..', 'cli.js');
const PUBLIC = path.join(__dirname, 'public');
const CLI_TIMEOUT_MS = 180000;

// Read-only lists, always asked as JSON.
const READS = new Set(['routines', 'devices', 'appliances', 'skills', 'audit']);
// Commands that change something, with the options each one accepts. Run as a dry run unless apply is set.
const WRITES = {
    create: { positional: false, options: ['phrase', 'device', 'op', 'name'] },
    phrases: { positional: true, options: ['add', 'remove'] },
    retarget: { positional: true, options: ['device', 'from', 'op'] },
    enable: { positional: true, options: [] },
    disable: { positional: true, options: [] },
    delete: { positional: true, options: [] },
    forget: { positional: true, options: ['force'] },
    run: { positional: true, options: ['on'], noDryRun: true },
};
const REPEATED = new Set(['phrase', 'add', 'remove']);
const BOOLEANS = new Set(['force']);

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

// One CLI at a time: concurrent runs could each refresh and rewrite the stored Amazon tokens.
let queue = Promise.resolve();
function runCli(argv) {
    const job = queue.then(() => new Promise((resolve) => {
        execFile(process.execPath, [CLI, ...argv], { timeout: CLI_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
            (err, stdout, stderr) => resolve({ ok: !err, code: err ? (err.code ?? 1) : 0, stdout, stderr }));
    }));
    queue = job.catch(() => {});
    return job;
}

function text(value, what) {
    if (typeof value !== 'string' || !value.trim() || value.length > 300) throw new Error(`invalid ${what}`);
    // A value starting with "--" would be read as an option by the CLI.
    if (value.startsWith('-')) throw new Error(`${what} may not start with "-"`);
    return value;
}

function writeArgv(command, body) {
    const spec = WRITES[command];
    const argv = [command];
    if (spec.positional) argv.push(text(body.target, 'target'));
    for (const key of spec.options) {
        const value = body[key];
        if (value === undefined || value === null || value === '' || value === false) continue;
        if (BOOLEANS.has(key)) {
            if (value !== true) throw new Error(`invalid ${key}`);
            argv.push(`--${key}`);
        } else if (REPEATED.has(key)) {
            const list = Array.isArray(value) ? value : [value];
            if (list.length > 30) throw new Error(`too many ${key}`);
            for (const v of list) argv.push(`--${key}`, text(v, key));
        } else {
            argv.push(`--${key}`, text(value, key));
        }
    }
    if (body.apply === true && !spec.noDryRun) argv.push('--apply');
    return argv;
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
    res.writeHead(status, {
        'Content-Type': type,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:",
    });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (c) => {
            size += c.length;
            if (size > 64 * 1024) {
                reject(new Error('body too large'));
                req.destroy();
            } else chunks.push(c);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

const server = http.createServer(async (req, res) => {
    // Only this machine, under its own name: refuses DNS-rebinding pages that point another name at 127.0.0.1.
    const host = req.headers.host || '';
    if (host !== `${HOST}:${PORT}` && host !== `localhost:${PORT}`) return send(res, 421, { error: 'wrong host' });
    const url = new URL(req.url, `http://${host}`);

    try {
        if (req.method === 'GET' && url.pathname.startsWith('/api/list/')) {
            const kind = url.pathname.slice('/api/list/'.length);
            if (!READS.has(kind)) return send(res, 404, { error: 'unknown list' });
            const out = await runCli([kind, '--json']);
            if (!out.ok) return send(res, 502, { error: (out.stderr || out.stdout).trim() });
            return send(res, 200, out.stdout);
        }

        if (req.method === 'POST' && url.pathname.startsWith('/api/do/')) {
            // A custom header and a JSON body: a page on another site cannot send this without a CORS preflight,
            // which this server never answers.
            if (req.headers['x-alexa-cli'] !== '1' || !String(req.headers['content-type']).startsWith('application/json')) {
                return send(res, 403, { error: 'forbidden' });
            }
            const command = url.pathname.slice('/api/do/'.length);
            if (!Object.hasOwn(WRITES, command)) return send(res, 404, { error: 'unknown command' });
            let argv;
            try {
                argv = writeArgv(command, JSON.parse(await readBody(req) || '{}'));
            } catch (e) {
                return send(res, 400, { error: e.message });
            }
            const out = await runCli(argv);
            return send(res, out.ok ? 200 : 422, { ...out, argv });
        }

        if (req.method === 'GET') {
            const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
            const file = path.join(PUBLIC, path.normalize(rel));
            if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
                return send(res, 404, 'not found', 'text/plain; charset=utf-8');
            }
            return send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
        }

        send(res, 405, { error: 'method not allowed' });
    } catch (e) {
        send(res, 500, { error: e.message });
    }
});

server.listen(PORT, HOST, () => console.log(`alexa-cli interface: http://${HOST}:${PORT}/`));
