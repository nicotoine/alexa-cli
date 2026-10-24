// Signing in to Amazon and out again.

import { authFile, clearAuth, loadAuth } from '../auth.js';
import { connect } from '../client.js';

const login = {
    name: 'login',
    group: 'Account',
    summary: 'Sign in to Amazon (a local page opens the real Amazon login)',
    description: 'The login runs through a proxy on 127.0.0.1 only: alexa-cli never sees the password and keeps the\n'
        + `resulting tokens in ${authFile()} (mode 0600).`,
    async run(ctx) {
        await connect({
            interactive: true,
            debug: ctx.opts.debug,
            onLoginUrl: (url) => {
                ctx.out.note(`Open ${url} in your browser and sign in to Amazon (two-step verification included).`);
                ctx.out.note('Waiting for the login to finish…');
            },
        });
        ctx.out.line(`Logged in. Tokens stored in ${authFile()}.`);
    },
};

const logout = {
    name: 'logout',
    group: 'Account',
    summary: 'Forget the stored Amazon tokens',
    async run(ctx) {
        ctx.out.line(clearAuth() ? `Removed ${authFile()}.` : 'Not logged in: nothing to remove.');
    },
};

const status = {
    name: 'status',
    group: 'Account',
    summary: 'Whether a session is stored, and whether Amazon still accepts it',
    modes: ['json'],
    async run(ctx) {
        const stored = Boolean(loadAuth());
        let valid = false;
        let error = null;
        if (stored) {
            try {
                await (await ctx.client()).routines();
                valid = true;
            } catch (e) {
                error = e.message;
            }
        }
        ctx.out.document({ stored, valid, file: authFile(), error }, (d) => {
            ctx.out.line(!d.stored ? 'Not logged in: run "alexa-cli login".'
                : d.valid ? `Logged in (${d.file}).` : `Session stored but refused by Amazon: ${d.error}. Run "alexa-cli login".`);
        });
        if (!valid) return 1;
    },
};

export default [login, logout, status];
