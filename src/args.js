// Commands are declared, not hand-parsed: one description per command gives the parser, `--help`, shell
// completion and the pinned command surface (test/command_surface.json) — four things that would otherwise drift
// apart one edit at a time.
//
// A command:
//   { name, group, summary, args: [{ name, required, help }], options: [{ name, type, help, choices, metavar }],
//     modes: ['json', 'plain'], run(ctx, input) }
// Option types: 'flag', 'string', 'list' (repeatable), 'choice'.

export class UsageError extends Error {}

// Accepted by every command; `modes` says which of --json / --plain a command honours.
export const GLOBAL_OPTIONS = [
    { name: 'json', type: 'flag', help: 'Machine output: one JSON document on stdout, errors as JSON too' },
    { name: 'plain', type: 'flag', help: 'One tab-separated record per line, nothing wrapped or padded' },
    { name: 'debug', type: 'flag', help: 'Log the Alexa requests to stderr (truncated)' },
    { name: 'help', type: 'flag', help: 'Show help' },
];

export const APPLY = { name: 'apply', type: 'flag', help: 'Do it (without it, only say what would be done)' };

export function parse(command, argv) {
    const options = [...(command.options || []), ...GLOBAL_OPTIONS];
    const byName = new Map(options.map((o) => [o.name, o]));
    const opts = Object.fromEntries(options.map((o) => [o.name, o.type === 'list' ? [] : o.type === 'flag' ? false : undefined]));
    const positional = [];
    for (let i = 0; i < argv.length; i++) {
        const token = argv[i];
        if (token === '--') {
            positional.push(...argv.slice(i + 1));
            break;
        }
        if (!token.startsWith('--') || token === '--') {
            positional.push(token);
            continue;
        }
        const [rawName, inline] = token.slice(2).split(/=(.*)/s);
        const spec = byName.get(rawName);
        if (!spec) throw new UsageError(`unknown option --${rawName} for "${command.name}"`);
        if (spec.type === 'flag') {
            if (inline !== undefined) throw new UsageError(`--${rawName} takes no value`);
            opts[spec.name] = true;
            continue;
        }
        const value = inline !== undefined ? inline : argv[++i];
        if (value === undefined) throw new UsageError(`--${rawName} needs a value`);
        if (spec.type === 'choice' && !spec.choices.includes(value)) {
            throw new UsageError(`--${rawName} must be one of: ${spec.choices.join(', ')}`);
        }
        if (spec.type === 'list') opts[spec.name].push(value);
        else opts[spec.name] = value;
    }
    if (opts.json && opts.plain) throw new UsageError('--json and --plain exclude each other');
    for (const mode of ['json', 'plain']) {
        if (opts[mode] && !(command.modes || []).includes(mode)) throw new UsageError(`"${command.name}" has no --${mode} output`);
    }
    const declared = command.args || [];
    if (!opts.help) {
        if (positional.length > declared.length) throw new UsageError(`unexpected argument "${positional[declared.length]}"`);
        const missing = declared.find((a, i) => a.required && positional[i] === undefined);
        if (missing) throw new UsageError(`"${command.name}" needs <${missing.name}>`);
    }
    const args = Object.fromEntries(declared.map((a, i) => [a.name, positional[i]]));
    return { args, opts };
}

// ---- help -------------------------------------------------------------------------------------------------

function optionLabel(o) {
    const value = o.type === 'flag' ? '' : o.type === 'choice' ? ` ${o.choices.join('|')}` : ` ${o.metavar || 'TEXT'}`;
    return `--${o.name}${value}${o.type === 'list' ? ' …' : ''}`;
}

function usageLine(prog, c) {
    const args = (c.args || []).map((a) => (a.required ? `<${a.name}>` : `[${a.name}]`));
    return [prog, c.name, ...args, (c.options || []).length ? '[options]' : ''].filter(Boolean).join(' ');
}

export function commandHelp(prog, c) {
    const rows = [...(c.args || []).map((a) => [`<${a.name}>`, a.help || '']),
        ...(c.options || []).map((o) => [optionLabel(o), o.help || '']),
        ...GLOBAL_OPTIONS.filter((o) => o.name === 'help' || (c.modes || []).includes(o.name)).map((o) => [optionLabel(o), o.help])];
    const width = Math.max(...rows.map(([l]) => l.length));
    return [`usage: ${usageLine(prog, c)}`, '', c.summary, ...(c.description ? ['', c.description] : []), '',
        ...rows.map(([l, h]) => `  ${l.padEnd(width)}  ${h}`)].join('\n');
}

export function mainHelp(prog, commands, intro) {
    const width = Math.max(...commands.map((c) => c.name.length));
    const groups = [...new Set(commands.map((c) => c.group))];
    return [intro, '', `usage: ${prog} <command> [options]`, '',
        ...groups.flatMap((g) => [g, ...commands.filter((c) => c.group === g).map((c) => `  ${c.name.padEnd(width)}  ${c.summary}`), '']),
        `Run "${prog} <command> --help" for the options of a command.`].join('\n');
}

// ---- the pinned surface -----------------------------------------------------------------------------------

// Every command with its parameters' name, type and arity — the contract a caller depends on — and no help
// text, so rewording a description never trips the test that pins it.
export function commandSurface(prog, commands) {
    return Object.fromEntries(commands.map((c) => [`${prog} ${c.name}`, [
        ...(c.args || []).map((a) => `<${a.name}>${a.required ? '!' : ''}`),
        ...(c.options || []).map((o) => `--${o.name} ${o.type.toUpperCase()}${o.choices ? `(${o.choices.join('|')})` : ''}`),
        ...(c.modes || []).map((m) => `--${m} MODE`),
    ].sort()]));
}

// ---- shell completion -------------------------------------------------------------------------------------

export function completionScript(shell, prog, commands) {
    const fn = `_${prog.replace(/[^a-z0-9]/gi, '_')}_complete`;
    const optionsOf = (c) => [...(c.options || []), ...GLOBAL_OPTIONS.filter((o) => o.name === 'help' || (c.modes || []).includes(o.name))]
        .map((o) => `--${o.name}`);
    if (shell === 'bash' || shell === 'zsh') {
        const cases = commands.map((c) => `        ${c.name}) opts="${optionsOf(c).join(' ')}" ;;`).join('\n');
        return `# ${prog} completion (${shell}) — generated by "${prog} completion ${shell}"
${shell === 'zsh' ? 'autoload -U +X bashcompinit && bashcompinit\n' : ''}${fn}() {
    local cur=\${COMP_WORDS[COMP_CWORD]} opts
    if [ "$COMP_CWORD" -eq 1 ]; then
        COMPREPLY=( $(compgen -W "${commands.map((c) => c.name).join(' ')}" -- "$cur") )
        return
    fi
    case "\${COMP_WORDS[1]}" in
${cases}
        *) opts="" ;;
    esac
    [[ "$cur" == -* ]] && COMPREPLY=( $(compgen -W "$opts" -- "$cur") )
}
complete -F ${fn} ${prog}
`;
    }
    if (shell === 'fish') {
        const lines = [`# ${prog} completion (fish) — generated by "${prog} completion fish"`,
            `complete -c ${prog} -f`,
            ...commands.map((c) => `complete -c ${prog} -n "__fish_use_subcommand" -a ${c.name} -d ${JSON.stringify(c.summary)}`),
            ...commands.flatMap((c) => [...(c.options || []), ...GLOBAL_OPTIONS.filter((o) => o.name === 'help' || (c.modes || []).includes(o.name))]
                .map((o) => `complete -c ${prog} -n "__fish_seen_subcommand_from ${c.name}" -l ${o.name}${o.type === 'flag' ? '' : ' -r'}${o.choices ? ` -a "${o.choices.join(' ')}"` : ''} -d ${JSON.stringify(o.help || '')}`))];
        return `${lines.join('\n')}\n`;
    }
    throw new UsageError(`unsupported shell "${shell}" (bash, zsh or fish)`);
}
