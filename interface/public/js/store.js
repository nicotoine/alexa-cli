// The optimistic store. What the page shows (`view`) is the last data from Amazon (`base`) with every change still
// in progress drawn on top (`ops`). A change is drawn at once; undoing it or a refusal from Amazon only drops it
// from `ops`, and the view falls back to what Amazon says without disturbing the other changes in flight.
// No DOM here: tested in Node.

const clone = (v) => (v == null ? v : structuredClone(v));

export function createStore({ kinds, onChange = () => {}, now = Date.now }) {
    const base = Object.fromEntries(kinds.map((k) => [k, null]));
    const view = Object.fromEntries(kinds.map((k) => [k, null]));
    const ops = new Set();

    // Patches are idempotent and skip lists not loaded yet, so they can run whatever has arrived so far.
    function recompute(changed = kinds) {
        for (const k of changed) view[k] = clone(base[k]);
        for (const op of ops) {
            if (!op.kinds.some((k) => changed.includes(k))) continue;
            try {
                op.patch(view);
            } catch (e) {
                console.error('patch', e);
            }
        }
        onChange(changed);
    }

    // A confirmed change stays drawn until a snapshot that started after it has refreshed every list it touches:
    // a snapshot already on its way may still carry the old state.
    function prune() {
        for (const op of ops) if (op.doneAt && op.kinds.every((k) => op.settled.has(k))) ops.delete(op);
    }

    return {
        view,
        base,
        ops,

        /** Data from Amazon. A cached copy never replaces data already there. `since`: when that snapshot began. */
        receive(kind, data, { cached = false, since = null } = {}) {
            if (cached && base[kind]) return false;
            base[kind] = data;
            if (!cached && since !== null) {
                for (const op of ops) if (op.doneAt && op.doneAt < since && op.kinds.includes(kind)) op.settled.add(kind);
                prune();
            }
            recompute([kind]);
            return true;
        },

        /** Draws a change now. `patch(view)` must be idempotent and tolerate lists that are still null. */
        begin({ key, kinds: touched, patch }) {
            const op = { key, kinds: touched, patch, settled: new Set(), doneAt: null };
            ops.add(op);
            recompute(touched);
            return op;
        },

        /** Amazon accepted it. */
        confirm(op) {
            op.doneAt = now();
            onChange([]);
        },

        /** Undone, or refused: the view returns to Amazon's state for what it touched. */
        cancel(op) {
            ops.delete(op);
            recompute(op.kinds);
        },

        saving: () => [...ops].filter((o) => !o.doneAt).length,
        isPending: (key) => [...ops].some((o) => !o.doneAt && o.key === key),
    };
}
