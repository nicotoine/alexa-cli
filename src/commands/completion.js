// Shell completion, generated from the same command declarations as the parser (install-completion.sh wires it).

import { completionScript } from '../args.js';

const completion = {
    name: 'completion',
    group: 'Setup',
    summary: 'Print the shell completion script (bash, zsh or fish)',
    args: [{ name: 'shell', required: true, help: 'bash, zsh or fish' }],
    async run(ctx, { args }) {
        process.stdout.write(completionScript(args.shell, ctx.prog, ctx.commands));
    },
};

export default [completion];
