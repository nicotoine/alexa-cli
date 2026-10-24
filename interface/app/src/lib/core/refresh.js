// When the page reads Amazon again on its own, so what it shows is never long out of date. Pure of the DOM: the
// page tells it when it becomes visible or comes back online, and gives it what to check; tested in Node.
//
//   - every `every` ms while the page is visible;
//   - at once when it becomes visible again or comes back online, if the last read is older than `minGap`;
//   - never while a change is being sent (`isBusy`): it tries again `retry` ms later, so a read cannot start under
//     a change and the queue keeps its order;
//   - never twice at a time: `refresh()` returns a promise, and a read already under way is the one waited for.

export function createRefresher({
    refresh,
    isVisible = () => true,
    isBusy = () => false,
    every = 120000,
    minGap = 30000,
    retry = 3000,
    now = Date.now,
    schedule = setTimeout,
    unschedule = clearTimeout,
}) {
    let last = now();
    let timer = null;
    let running = null;
    let stopped = false;

    const plan = (ms) => {
        unschedule(timer);
        if (!stopped) timer = schedule(tick, ms);
    };

    async function run() {
        if (running) return running;
        running = (async () => {
            try {
                await refresh();
            } finally {
                last = now();
                running = null;
            }
        })();
        return running;
    }

    async function tick() {
        if (!isVisible()) return plan(every);
        if (isBusy()) return plan(retry);
        await run().catch(() => {});
        plan(every);
    }

    return {
        start() {
            stopped = false;
            plan(every);
        },
        stop() {
            stopped = true;
            unschedule(timer);
        },
        /** A read the page made itself (first load, reload button): the next automatic one is counted from it. */
        noteRead() {
            last = now();
            plan(every);
        },
        /** The page is visible again, or back online: read now if what it shows is getting old. */
        wake() {
            if (now() - last >= minGap) {
                unschedule(timer);
                return tick();
            }
            return Promise.resolve();
        },
        get running() {
            return Boolean(running);
        },
    };
}
