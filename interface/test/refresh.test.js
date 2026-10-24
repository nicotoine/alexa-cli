import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRefresher } from '../app/src/lib/core/refresh.js';

function setup({ visible = true, busy = false } = {}) {
    let clock = 0;
    const timers = [];
    const state = { visible, busy, reads: 0, release: null };
    const refresher = createRefresher({
        refresh: () => {
            state.reads++;
            return new Promise((resolve) => { state.release = resolve; });
        },
        isVisible: () => state.visible,
        isBusy: () => state.busy,
        every: 1000,
        minGap: 300,
        retry: 100,
        now: () => clock,
        schedule: (fn, ms) => { const t = { fn, at: clock + ms }; timers.push(t); return t; },
        unschedule: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
    });
    // Moves the clock and runs what was due, in order.
    const advance = async (ms) => {
        const end = clock + ms;
        for (;;) {
            timers.sort((a, b) => a.at - b.at);
            if (!timers.length || timers[0].at > end) break;
            const t = timers.shift();
            clock = t.at;
            t.fn();
            await Promise.resolve();
        }
        clock = end;
    };
    const finish = async () => { state.release(); await new Promise((r) => setImmediate(r)); };
    return { refresher, state, advance, finish };
}

describe('the automatic refresh', () => {
    it('reads again every period while the page is visible', async () => {
        const { refresher, state, advance, finish } = setup();
        refresher.start();
        await advance(999);
        assert.equal(state.reads, 0);
        await advance(1);
        assert.equal(state.reads, 1);
        await finish();
        await advance(1000);
        assert.equal(state.reads, 2);
    });

    it('does not read while the page is hidden', async () => {
        const { refresher, state, advance } = setup({ visible: false });
        refresher.start();
        await advance(5000);
        assert.equal(state.reads, 0);
    });

    it('waits for the changes being sent, then reads', async () => {
        const { refresher, state, advance } = setup({ busy: true });
        refresher.start();
        await advance(1000);
        assert.equal(state.reads, 0, 'not under a change in flight');
        state.busy = false;
        await advance(100);
        assert.equal(state.reads, 1, 'right after it, not a whole period later');
    });

    it('reads at once when the page comes back, only if what it shows is getting old', async () => {
        const { refresher, state, advance, finish } = setup();
        refresher.start();
        await advance(200);
        await refresher.wake();
        assert.equal(state.reads, 0, 'read 200 ms ago: still fresh');
        await advance(200);
        refresher.wake();
        await Promise.resolve();
        assert.equal(state.reads, 1);
        await finish();
    });

    it('never runs two reads at a time', async () => {
        const { refresher, state, advance } = setup();
        refresher.start();
        await advance(1000);
        assert.equal(state.reads, 1);
        await advance(400);
        refresher.wake();
        refresher.wake();
        await Promise.resolve();
        assert.equal(state.reads, 1, 'the read under way is the one waited for');
    });

    it('counts from a read the page made itself', async () => {
        const { refresher, state, advance } = setup();
        refresher.start();
        await advance(900);
        refresher.noteRead();
        await advance(900);
        assert.equal(state.reads, 0);
        await advance(100);
        assert.equal(state.reads, 1);
    });
});
