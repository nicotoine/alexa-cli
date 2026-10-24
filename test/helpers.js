import { main } from '../src/cli.js';
import { createOutput } from '../src/ui.js';

function streams() {
    const text = { stdout: '', stderr: '' };
    const stream = (key) => ({ isTTY: false, write: (s) => { text[key] += s; return true; } });
    return { text, stdout: stream('stdout'), stderr: stream('stderr') };
}

export function capture(mode) {
    const s = streams();
    return { out: createOutput({ mode, stdout: s.stdout, stderr: s.stderr }), streams: s.text };
}

/** Runs the CLI against a fake client; returns the exit code and what was written. */
export async function cli(argv, client) {
    const s = streams();
    const connectFn = async () => {
        if (client instanceof Error) throw client;
        return client;
    };
    const code = await main(argv, { stdout: s.stdout, stderr: s.stderr, connectFn });
    return { code, ...s.text, json: () => JSON.parse(s.text.stdout) };
}
