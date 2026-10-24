// The front end: global options, help, dispatch to a command and error rendering. The commands live in
// commands/, one module per feature; output in ui, the Alexa client in client, the logic in model.

import fs from 'node:fs';
import { COMMANDS } from './commands/index.js';
import { UsageError, commandHelp, mainHelp, parse } from './args.js';
import { createContext } from './context.js';
import { createOutput } from './ui.js';

export const PROG = 'alexa-cli';

const INTRO = 'alexa-cli — Alexa smart-home devices and voice routines from the terminal (unofficial Alexa app API).';

function version() {
    return JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
}

/** Runs one invocation and returns its exit code: 0 done, 1 failed, 2 wrong usage. */
export async function main(argv, { stdout = process.stdout, stderr = process.stderr, connectFn } = {}) {
    const [name, ...rest] = argv;
    if (!name || name === '--help' || name === 'help') {
        stdout.write(`${mainHelp(PROG, COMMANDS, INTRO)}\n`);
        return name ? 0 : 2;
    }
    if (name === '--version') {
        stdout.write(`${version()}\n`);
        return 0;
    }
    const command = COMMANDS.find((c) => c.name === name);
    const wantsJson = rest.includes('--json');
    if (!command) {
        createOutput({ mode: wantsJson ? 'json' : 'human', stdout, stderr })
            .error(new Error(`unknown command "${name}" — run "${PROG} --help"`));
        return 2;
    }

    let input;
    try {
        input = parse(command, rest);
    } catch (e) {
        if (!(e instanceof UsageError)) throw e;
        createOutput({ mode: wantsJson ? 'json' : 'human', stdout, stderr }).error(e);
        if (!wantsJson) stderr.write(`run "${PROG} ${command.name} --help" for its options\n`);
        return 2;
    }
    if (input.opts.help) {
        stdout.write(`${commandHelp(PROG, command)}\n`);
        return 0;
    }

    const out = createOutput({ mode: input.opts.json ? 'json' : input.opts.plain ? 'plain' : 'human', stdout, stderr });
    // stdout is passed down for the commands that stream raw lines (snapshot): in-process callers capture it.
    const ctx = { ...createContext({ out, opts: input.opts, ...(connectFn ? { connectFn } : {}) }), prog: PROG, commands: COMMANDS, stdout };
    try {
        const code = await command.run(ctx, input);
        return typeof code === 'number' ? code : 0;
    } catch (e) {
        out.error(e);
        return e instanceof UsageError ? 2 : 1;
    }
}
