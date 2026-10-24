// What a command receives: its output, its parsed input, and the Alexa client, connected on first use only
// (help, completion and usage errors never touch the network).

import { connect } from './client.js';

export function createContext({ out, opts, connectFn = connect }) {
    let client = null;
    return {
        out,
        opts,
        client() {
            client = client || connectFn({ debug: opts.debug });
            return client;
        },
    };
}

/**
 * The shape of every acting command: say what will happen, and only do it with --apply.
 * `run` performs the change and returns a confirmation message.
 */
export async function act(ctx, { plan, run, details = {} }) {
    if (!ctx.opts.apply) return ctx.out.action({ applied: false, plan, ...details });
    const message = await run();
    return ctx.out.action({ applied: true, plan, message, ...details });
}
