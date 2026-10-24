// What the interface changed on the account, one JSON line per applied change, in the config directory next to
// the session. Kept because a morning of routines disappearing could not be traced back to anyone: the next time,
// this file says what the interface did and when.

import fs from 'node:fs';
import path from 'node:path';
import { configDir } from '../../src/auth.js';

const MAX_LINES = 2000;

export function journalFile() {
    return path.join(configDir(), 'journal.jsonl');
}

/** Records one applied change. Never throws: a journal that cannot be written must not block the change. */
export function record(entry, { file = journalFile(), now = () => new Date() } = {}) {
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        fs.appendFileSync(file, `${JSON.stringify({ at: now().toISOString(), ...entry })}\n`, { mode: 0o600 });
        trim(file);
    } catch {
        // Not recorded: the change itself already happened, and its answer still reaches the page.
    }
}

/** The latest entries, newest first. */
export function read({ file = journalFile(), limit = 100 } = {}) {
    let text;
    try {
        text = fs.readFileSync(file, 'utf8');
    } catch {
        return [];
    }
    return text.trim().split('\n').filter(Boolean).slice(-limit).reverse().flatMap((line) => {
        try {
            return [JSON.parse(line)];
        } catch {
            return [];
        }
    });
}

// Keeps the file bounded: past MAX_LINES, the oldest half goes.
function trim(file) {
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    if (lines.length > MAX_LINES) fs.writeFileSync(file, `${lines.slice(-MAX_LINES / 2).join('\n')}\n`, { mode: 0o600 });
}
