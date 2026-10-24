// The activity queue: every change the page sends, from the moment it is asked to its outcome. What the compact
// toast and its sheet show. Pure: tested in Node.
//
// An item goes   waiting (undo window) → running → done
//                                     ↘ cancelled          ↘ failed (with the reason, and a retry)
// Finished items stay listed (the latest `keep`), so what happened can be read back after the toast is gone.

export const STATES = ['waiting', 'running', 'done', 'failed', 'cancelled'];
const ACTIVE = new Set(['waiting', 'running']);

export function createActivity({ now = Date.now, keep = 30, onChange = () => {} } = {}) {
    let seq = 0;
    let items = [];

    const changed = () => onChange(items);
    const prune = () => {
        const active = items.filter((i) => ACTIVE.has(i.state));
        const finished = items.filter((i) => !ACTIVE.has(i.state)).slice(-keep);
        items = [...finished, ...active].sort((a, b) => a.id - b.id);
    };

    return {
        get items() {
            return items;
        },

        /** A new item; `deadline` (ms timestamp) for one waiting behind an undo. Returns its id. */
        add({ label, state = 'running', deadline = null, undo = null }) {
            const item = { id: ++seq, label, state, deadline, undo, startedAt: now(), endedAt: null, detail: null, retry: null, action: null };
            items = [...items, item];
            changed();
            return item.id;
        },

        update(id, patch) {
            items = items.map((i) => (i.id === id ? { ...i, ...patch, ...(patch.state && !ACTIVE.has(patch.state) ? { endedAt: now() } : {}) } : i));
            prune();
            changed();
        },

        dismiss(id) {
            items = items.filter((i) => i.id !== id || ACTIVE.has(i.state));
            changed();
        },

        clearFinished() {
            items = items.filter((i) => ACTIVE.has(i.state));
            changed();
        },

        /** What the compact toast says: how many are under way, and the latest outcome. */
        summary() {
            const running = items.filter((i) => i.state === 'running').length;
            const waiting = items.filter((i) => i.state === 'waiting').length;
            const failed = items.filter((i) => i.state === 'failed').length;
            const last = [...items].reverse().find((i) => !ACTIVE.has(i.state)) || null;
            return { running, waiting, failed, busy: running + waiting > 0, last, total: items.length };
        },
    };
}
