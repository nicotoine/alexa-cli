// The command surface, pinned: every command with the name, type and arity of its parameters. A command or option
// that disappears raises nothing at import time — the CLI simply stops doing something — so it fails here instead.
// When the surface is meant to change: `npm run surface:update`, and say so in the commit.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { it } from 'node:test';
import { commandSurface } from '../src/args.js';
import { PROG } from '../src/cli.js';
import { COMMANDS } from '../src/commands/index.js';

const SNAPSHOT = new URL('./command_surface.json', import.meta.url);
const pinned = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
const actual = commandSurface(PROG, COMMANDS);

it('pins more than a handful of commands', () => {
    assert.ok(Object.keys(pinned).length > 15);
});

it('lost or gained no command', () => {
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(pinned).sort());
});

it('changed no parameter', () => {
    const changed = Object.keys(pinned).filter((k) => k in actual && JSON.stringify(actual[k]) !== JSON.stringify(pinned[k]))
        .map((k) => ({ command: k, before: pinned[k], after: actual[k] }));
    assert.deepEqual(changed, []);
});

it('declares --apply on every command that changes something, and on nothing else', () => {
    const writes = ['create', 'phrases', 'retarget', 'enable', 'disable', 'delete', 'forget'];
    const withApply = COMMANDS.filter((c) => (c.options || []).some((o) => o.name === 'apply')).map((c) => c.name);
    assert.deepEqual(withApply.sort(), writes.sort());
});

it('gives every listing a way out for scripts (--json or --plain)', () => {
    const listings = ['routines', 'devices', 'appliances', 'skills', 'audit'];
    for (const name of listings) {
        const c = COMMANDS.find((x) => x.name === name);
        assert.ok(c.modes.includes('json') && c.modes.includes('plain'), name);
    }
});
