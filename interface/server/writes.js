// The changes the interface may ask for, and how a request body becomes CLI arguments. Nothing else reaches the
// CLI: an unknown command, an unknown option or a value that would read as an option is refused here.

export class BadRequest extends Error {}

export const WRITES = {
    create: { positional: false, options: ['spec', 'phrase', 'device', 'op', 'name'] },
    update: { positional: true, options: ['spec'] },
    phrases: { positional: true, options: ['add', 'remove'] },
    retarget: { positional: true, options: ['device', 'from', 'op'] },
    enable: { positional: true, options: [] },
    disable: { positional: true, options: [] },
    delete: { positional: true, options: [] },
    forget: { positional: true, options: ['force'] },
    // Runs at once: there is nothing to preview.
    run: { positional: true, options: ['on'], immediate: true },
};

const LISTS = new Set(['phrase', 'add', 'remove']);
const FLAGS = new Set(['force']);
const MAX_LENGTH = 300;
// A spec is a whole routine: far longer than a name, and JSON the CLI parses itself.
const MAX_SPEC = 32 * 1024;
const MAX_ITEMS = 30;

function text(value, what) {
    if (typeof value !== 'string' || !value.trim() || value.length > MAX_LENGTH) throw new BadRequest(`invalid ${what}`);
    // A value starting with "-" would be read as an option by the CLI.
    if (value.startsWith('-')) throw new BadRequest(`${what} may not start with "-"`);
    return value;
}

/** CLI arguments for one change; `apply` false gives the dry run. Always --json, so the answer is a document. */
export function writeArgv(command, body = {}) {
    if (!Object.hasOwn(WRITES, command)) throw new BadRequest(`unknown command "${command}"`);
    const spec = WRITES[command];
    const argv = [command];
    if (spec.positional) argv.push(text(body.target, 'target'));
    for (const key of spec.options) {
        const value = body[key];
        if (value === undefined || value === null || value === '' || value === false) continue;
        if (key === 'spec') {
            const json = typeof value === 'string' ? value : JSON.stringify(value);
            if (json.length > MAX_SPEC) throw new BadRequest('spec too large');
            argv.push('--spec', json);
        } else if (FLAGS.has(key)) {
            if (value !== true) throw new BadRequest(`invalid ${key}`);
            argv.push(`--${key}`);
        } else if (LISTS.has(key)) {
            const list = Array.isArray(value) ? value : [value];
            if (list.length > MAX_ITEMS) throw new BadRequest(`too many ${key}`);
            for (const v of list) argv.push(`--${key}`, text(v, key));
        } else {
            argv.push(`--${key}`, text(value, key));
        }
    }
    const unknown = Object.keys(body).filter((k) => !['target', 'apply', ...spec.options].includes(k));
    if (unknown.length) throw new BadRequest(`unknown field ${unknown.join(', ')}`);
    if (body.apply === true && !spec.immediate) argv.push('--apply');
    argv.push('--json');
    return argv;
}
