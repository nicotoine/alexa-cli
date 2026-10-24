// The app's state for Svelte: the optimistic store, the activity queue and the actions (all pure, see core/), the
// streamed loading, the saved sort/filter choices, the Amazon session and the build. One `version` rune is bumped on
// every change of the store or the queue, so anything that reads `app.view` or `app.activity` re-renders.

import { createActions } from '$lib/core/actions.js';
import { createActivity } from '$lib/core/activity.js';
import { change, login, session, snapshot, version as fetchVersion } from '$lib/core/api.js';
import { explain } from '$lib/core/explain.js';
import { loadPrefs, savePrefs } from '$lib/core/prefs.js';
import { createStore } from '$lib/core/store.js';

export const KINDS = ['routines', 'devices', 'appliances', 'echos', 'skills', 'audit'];
const NEEDS_LOGIN = /not logged in|401|Unauthorized|Cookie invalid|alexa-cli login/i;

type Sync = { state: 'loading' | 'cached' | 'ok' | 'error' | 'saving'; text: string };
type Tab = 'routines' | 'devices' | 'skills';

class App {
    version = $state(0);
    syncState = $state<Sync>({ state: 'loading', text: 'Chargement…' });
    needsLogin = $state(false);
    prefs = $state(loadPrefs());
    build = $state<{ label: string } | null>(null);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    store: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    activityQueue: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    actions: any;
    private loading: Promise<void> | null = null;
    private resyncTimer: ReturnType<typeof setTimeout> | undefined;
    private loginPoll: ReturnType<typeof setInterval> | undefined;

    constructor() {
        const bump = () => { this.version++; };
        this.store = createStore({ kinds: KINDS, onChange: bump });
        this.activityQueue = createActivity({ onChange: bump });
        this.actions = createActions({
            store: this.store,
            activity: this.activityQueue,
            change,
            explain,
            resync: () => this.scheduleResync(),
        });
    }

    /**
     * The store's view; reading it subscribes to every change. A new object each time: the store patches its view in
     * place, and a `$derived` that got the same reference back would not tell anything below it.
     */
    get view() {
        void this.version;
        return { ...this.store.view };
    }

    get activity() {
        void this.version;
        return this.activityQueue;
    }

    get sync(): Sync {
        void this.version;
        const saving = this.store.saving();
        return saving ? { state: 'saving', text: `Enregistrement (${saving})…` } : this.syncState;
    }

    isPending(key: string) {
        void this.version;
        return this.store.isPending(key);
    }

    start() {
        this.load();
        fetchVersion().then((b: { label: string }) => { this.build = b; }, () => {});
        window.addEventListener('beforeunload', (e) => { if (this.store.saving()) e.preventDefault(); });
    }

    // ---- streamed loading, cached copy first

    load({ silent = false } = {}) {
        if (this.loading) return this.loading;
        const since = Date.now();
        if (!silent) this.syncState = { state: 'loading', text: 'Chargement…' };
        this.loading = (async () => {
            let fresh = 0;
            let loggedOut = false;
            try {
                for await (const msg of snapshot()) {
                    if (msg.kind === 'error') {
                        if (NEEDS_LOGIN.test(msg.data.message)) {
                            loggedOut = true;
                            this.requireLogin();
                        } else {
                            const id = this.activityQueue.add({ label: `Chargement (${msg.data.kind})`, state: 'running' });
                            this.activityQueue.update(id, { state: 'failed', detail: explain(msg.data.message), retry: () => this.load() });
                        }
                        continue;
                    }
                    this.store.receive(msg.kind, msg.data, { cached: Boolean(msg.cached), since });
                    if (msg.cached) this.syncState = { state: 'cached', text: 'Cache, mise à jour…' };
                    else fresh++;
                }
                // Not signed in is not offline: the server answered, Amazon has no session for it yet.
                this.syncState = fresh
                    ? { state: 'ok', text: `À jour · ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` }
                    : { state: 'error', text: loggedOut ? 'Non connecté' : 'Hors ligne' };
            } catch (e) {
                this.syncState = { state: 'error', text: 'Hors ligne' };
                if (!silent) {
                    const id = this.activityQueue.add({ label: 'Chargement', state: 'running' });
                    this.activityQueue.update(id, { state: 'failed', detail: explain((e as Error).message), retry: () => this.load() });
                }
            } finally {
                this.loading = null;
            }
        })();
        return this.loading;
    }

    // Once nothing is in flight, reload quietly so the page matches Amazon again.
    private scheduleResync() {
        clearTimeout(this.resyncTimer);
        const tick = () => {
            if (this.store.saving()) this.resyncTimer = setTimeout(tick, 1200);
            else this.load({ silent: true });
        };
        this.resyncTimer = setTimeout(tick, 1200);
    }

    // ---- signing in from the page (there is no terminal on a phone)

    private requireLogin() {
        if (this.needsLogin) return;
        this.needsLogin = true;
        const check = async () => {
            if (document.visibilityState !== 'visible') return;
            try {
                if ((await session()).valid) {
                    clearInterval(this.loginPoll);
                    this.needsLogin = false;
                    this.load();
                }
            } catch {
                // Busy or restarting: the next tick will tell.
            }
        };
        this.loginPoll = setInterval(check, 4000);
        window.addEventListener('pageshow', check);
        document.addEventListener('visibilitychange', check);
    }

    async startLogin() {
        const started = await login();
        if (started.loggedIn) {
            this.needsLogin = false;
            this.load();
        } else {
            // Amazon's own page, through the proxy on this device; coming back, the session check notices.
            window.location.href = started.url;
        }
    }

    // ---- sort and filter choices

    setPrefs(tab: Tab, patch: Record<string, unknown>) {
        this.prefs = { ...this.prefs, [tab]: { ...this.prefs[tab], ...patch } };
        savePrefs($state.snapshot(this.prefs));
    }
}

export const app = new App();
