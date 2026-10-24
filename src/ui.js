// Output, in the three shapes a command can answer in:
//   - for a person: aligned columns, colour on a terminal;
//   - --plain: one record per line, fields separated by tabs, nothing wrapped, padded or rounded;
//   - --json: one document on stdout and nothing else; an error is a document too ({"error": …}).
// The exit code is the signal in every mode. Notes for a person (dry-run hints, progress) go to stderr, so
// they never end up in what a caller parses.

const ESCAPES = { '\\': '\\\\', '\t': '\\t', '\n': '\\n', '\r': '\\r' };

// A --plain field never holds a raw tab or newline, or one record would read as two.
export function plainField(value) {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) return value.map(plainField).join(' | ');
    return String(value).replace(/[\\\t\n\r]/g, (c) => ESCAPES[c]);
}

export function plainRow(fields) {
    return fields.map(plainField).join('\t');
}

const useColour = (stream) => stream.isTTY && !process.env.NO_COLOR;

export function createOutput({ mode = 'human', stdout = process.stdout, stderr = process.stderr } = {}) {
    const colour = useColour(stdout);
    const paint = (code) => (text) => (colour ? `\x1b[${code}m${text}\x1b[0m` : String(text));
    const style = { dim: paint('2'), bold: paint('1'), green: paint('32'), red: paint('31'), yellow: paint('33'), cyan: paint('36') };
    const write = (stream, text) => stream.write(`${text}\n`);

    return {
        mode,
        style,

        /** A document: the JSON itself with --json, a readable rendering otherwise. */
        document(doc, human = () => write(stdout, JSON.stringify(doc, null, 2))) {
            if (mode === 'json') return write(stdout, JSON.stringify(doc, null, 2));
            return human(doc);
        },

        /**
         * A listing. `columns` are [{ title, value: (record) => …, human?: (record) => … }]; --plain writes every
         * column's raw value, the person-facing table the `human` rendering when there is one.
         */
        list(records, columns, { empty = 'nothing to show' } = {}) {
            if (mode === 'json') return write(stdout, JSON.stringify(records, null, 2));
            if (mode === 'plain') {
                for (const r of records) write(stdout, plainRow(columns.map((c) => c.value(r))));
                return;
            }
            if (!records.length) return write(stderr, style.dim(empty));
            const cells = records.map((r) => columns.map((c) => String((c.human || c.value)(r) ?? '')));
            const widths = columns.map((c, i) => Math.max(c.title.length, ...cells.map((row) => visible(row[i]).length)));
            write(stdout, style.bold(columns.map((c, i) => c.title.padEnd(widths[i])).join('  ').trimEnd()));
            for (const row of cells) write(stdout, row.map((cell, i) => pad(cell, widths[i], i === row.length - 1)).join('  ').trimEnd());
        },

        /** What an acting command did (or, without --apply, would do). */
        action(result) {
            if (mode === 'json') return write(stdout, JSON.stringify(result, null, 2));
            write(stdout, result.plan);
            if (!result.applied) write(stderr, style.dim('(dry run: add --apply to do it)'));
            else if (result.message) write(stdout, style.green(result.message));
        },

        line(text) {
            if (mode !== 'json') write(stdout, text);
        },

        note(text) {
            write(stderr, style.dim(text));
        },

        error(err) {
            const message = err && err.message ? err.message : String(err);
            if (mode === 'json') return write(stdout, JSON.stringify({ error: message }));
            write(stderr, `${style.red('error:')} ${message}`);
        },
    };
}

// Width without the colour codes, so a coloured cell still lines up.
const visible = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const pad = (s, width, last) => (last ? s : s + ' '.repeat(Math.max(0, width - visible(s).length)));
