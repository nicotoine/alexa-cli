import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { UsageError, completionScript, parse } from '../src/args.js';
import { COMMANDS } from '../src/commands/index.js';

const command = {
    name: 'demo',
    args: [{ name: 'routine', required: true }, { name: 'extra' }],
    options: [
        { name: 'phrase', type: 'list' },
        { name: 'device', type: 'string' },
        { name: 'op', type: 'choice', choices: ['turnOn', 'turnOff'] },
        { name: 'apply', type: 'flag' },
    ],
    modes: ['json'],
};

describe('parse', () => {
    it('reads positionals, repeated options, values and flags', () => {
        const { args, opts } = parse(command, ['r', '--phrase', 'a', '--phrase=b c', '--device', 'Télé', '--apply', '--json']);
        assert.deepEqual(args, { routine: 'r', extra: undefined });
        assert.deepEqual([opts.phrase, opts.device, opts.apply, opts.json, opts.plain], [['a', 'b c'], 'Télé', true, true, false]);
    });

    it('takes what follows -- as positionals, even when it looks like an option', () => {
        assert.equal(parse(command, ['--', '--apply']).args.routine, '--apply');
    });

    for (const [argv, message] of [
        [['r', '--nope'], /unknown option --nope/],
        [['r', '--device'], /needs a value/],
        [['r', '--apply=yes'], /takes no value/],
        [['r', '--op', 'toggle'], /one of: turnOn, turnOff/],
        [[], /needs <routine>/],
        [['r', 'x', 'y'], /unexpected argument "y"/],
        [['r', '--plain'], /no --plain output/],
        [['r', '--json', '--plain'], /exclude each other/],
    ]) {
        it(`refuses ${JSON.stringify(argv)}`, () => {
            assert.throws(() => parse(command, argv), (e) => e instanceof UsageError && message.test(e.message));
        });
    }

    it('lets --help through without the required arguments', () => {
        assert.equal(parse(command, ['--help']).opts.help, true);
    });
});

describe('completion', () => {
    for (const shell of ['bash', 'zsh']) {
        it(`writes a ${shell} script bash accepts, naming every command`, () => {
            const script = completionScript(shell, 'alexa-cli', COMMANDS);
            for (const c of COMMANDS) assert.match(script, new RegExp(`\\b${c.name}\\b`));
            if (shell === 'bash') execFileSync('bash', ['-n'], { input: script });
        });
    }

    it('writes fish completions for every option', () => {
        const script = completionScript('fish', 'alexa-cli', COMMANDS);
        assert.match(script, /__fish_seen_subcommand_from phrases" -l add -r/);
    });

    it('refuses an unknown shell', () => {
        assert.throws(() => completionScript('tcsh', 'alexa-cli', COMMANDS), UsageError);
    });
});
