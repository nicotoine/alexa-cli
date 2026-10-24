import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { plainField, plainRow } from '../src/ui.js';
import { capture } from './helpers.js';

const columns = [{ title: 'NAME', value: (r) => r.name }, { title: 'PHRASES', value: (r) => r.phrases, human: (r) => String(r.phrases.length) }];
const records = [{ name: 'pause télé', phrases: ['a', 'b'] }, { name: 'multi\tline\nname', phrases: [] }];

describe('--plain', () => {
    it('keeps one record per line whatever the value holds', () => {
        assert.equal(plainField('a\tb\nc\\d'), 'a\\tb\\nc\\\\d');
        assert.equal(plainRow(['x', ['a', 'b'], null]), 'x\ta | b\t');
    });

    it('writes raw values, tab-separated, and nothing on stderr', () => {
        const { out, streams } = capture('plain');
        out.list(records, columns);
        assert.equal(streams.stdout, 'pause télé\ta | b\nmulti\\tline\\nname\t\n');
        assert.equal(streams.stderr, '');
    });
});

describe('--json', () => {
    it('writes the records and nothing else', () => {
        const { out, streams } = capture('json');
        out.list(records, columns);
        out.line('ignored in json');
        out.note('to stderr');
        assert.deepEqual(JSON.parse(streams.stdout), records);
    });

    it('writes an error as a JSON document', () => {
        const { out, streams } = capture('json');
        out.error(new Error('boom'));
        assert.deepEqual(JSON.parse(streams.stdout), { error: 'boom' });
    });
});

describe('for a person', () => {
    it('aligns columns and uses the human rendering', () => {
        const { out, streams } = capture('human');
        out.list(records.slice(0, 1), columns);
        assert.equal(streams.stdout, 'NAME        PHRASES\npause télé  2\n');
    });

    it('says when a list is empty, on stderr', () => {
        const { out, streams } = capture('human');
        out.list([], columns, { empty: 'no routine' });
        assert.equal(streams.stdout, '');
        assert.match(streams.stderr, /no routine/);
    });

    it('marks a dry run on stderr, so stdout holds only the plan', () => {
        const { out, streams } = capture('human');
        out.action({ applied: false, plan: 'delete "x"' });
        assert.equal(streams.stdout, 'delete "x"\n');
        assert.match(streams.stderr, /dry run/);
    });
});
