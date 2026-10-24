import assert from 'node:assert/strict';
import fs from 'node:fs';
import { it } from 'node:test';
import { versionInfo } from '../src/version.js';
import { cli } from './helpers.js';

const { version } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

it('reads the version from package.json, with no build when run from source', () => {
    const info = versionInfo();
    assert.equal(info.version, version);
    assert.equal(info.build, null);
    assert.equal(info.label, version);
});

it('prints it with --version', async () => {
    const r = await cli(['--version'], new Error('must not connect'));
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim(), version);
});
