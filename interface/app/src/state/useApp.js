// The app's state for React: the optimistic store, the activity queue and the actions (all pure, see lib/), the
// streamed loading, the saved sort/filter choices and the Amazon session.

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createActions } from '../lib/actions.js';
import { createActivity } from '../lib/activity.js';
import { change, login, session, snapshot } from '../lib/api.js';
import { explain } from '../lib/explain.js';
import { loadPrefs, savePrefs } from '../lib/prefs.js';
import { createStore } from '../lib/store.js';

export const KINDS = ['routines', 'devices', 'appliances', 'echos', 'skills', 'audit'];
const NEEDS_LOGIN = /not logged in|401|Unauthorized|Cookie invalid|alexa-cli login/i;

// A tiny external store: React re-renders on every change of the store's view or of the queue.
function useVersioned(subscribeRef) {
    return useSyncExternalStore(
        (listener) => {
            subscribeRef.current.add(listener);
            return () => subscribeRef.current.delete(listener);
        },
        () => subscribeRef.current.version,
    );
}

export function useApp() {
    const listeners = useRef(Object.assign(new Set(), { version: 0 }));
    const bump = useCallback(() => {
        listeners.current.version++;
        for (const l of listeners.current) l();
    }, []);

    const [sync, setSync] = useState({ state: 'loading', text: 'Chargement…' });
    const [needsLogin, setNeedsLogin] = useState(false);
    const [prefs, setPrefsState] = useState(loadPrefs);

    const core = useMemo(() => {
        const store = createStore({ kinds: KINDS, onChange: bump });
        const activity = createActivity({ onChange: bump });
        let resyncTimer = null;
        const actions = createActions({
            store, activity, change, explain,
            resync: () => {
                clearTimeout(resyncTimer);
                // Once nothing is in flight, reload quietly so the page matches Amazon again.
                const tick = () => (store.saving() ? (resyncTimer = setTimeout(tick, 1200)) : core.load({ silent: true }));
                resyncTimer = setTimeout(tick, 1200);
            },
        });
        return { store, activity, actions };
    }, [bump]);

    useVersioned(listeners);

    // ---- streamed loading, cached copy first

    const loading = useRef(null);
    core.load = useCallback(({ silent = false } = {}) => {
        if (loading.current) return loading.current;
        const since = Date.now();
        if (!silent) setSync({ state: 'loading', text: 'Chargement…' });
        loading.current = (async () => {
            let fresh = 0;
            try {
                for await (const msg of snapshot()) {
                    if (msg.kind === 'error') {
                        if (NEEDS_LOGIN.test(msg.data.message)) setNeedsLogin(true);
                        else {
                            const id = core.activity.add({ label: `Chargement (${msg.data.kind})`, state: 'running' });
                            core.activity.update(id, { state: 'failed', detail: explain(msg.data.message), retry: () => core.load() });
                        }
                        continue;
                    }
                    core.store.receive(msg.kind, msg.data, { cached: Boolean(msg.cached), since });
                    if (msg.cached) setSync({ state: 'cached', text: 'Cache, mise à jour…' });
                    else fresh++;
                }
                setSync(fresh
                    ? { state: 'ok', text: `À jour · ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` }
                    : { state: 'error', text: 'Hors ligne' });
            } catch (e) {
                setSync({ state: 'error', text: 'Hors ligne' });
                if (!silent) {
                    const id = core.activity.add({ label: 'Chargement', state: 'running' });
                    core.activity.update(id, { state: 'failed', detail: explain(e.message), retry: () => core.load() });
                }
            } finally {
                loading.current = null;
            }
        })();
        return loading.current;
    }, [core]);

    useEffect(() => { core.load(); }, [core]);

    // ---- signing in from the page

    useEffect(() => {
        if (!needsLogin) return undefined;
        const check = async () => {
            if (document.visibilityState !== 'visible') return;
            try {
                if ((await session()).valid) {
                    setNeedsLogin(false);
                    core.load();
                }
            } catch {
                // Busy or restarting: the next tick will tell.
            }
        };
        const timer = setInterval(check, 4000);
        window.addEventListener('pageshow', check);
        document.addEventListener('visibilitychange', check);
        return () => {
            clearInterval(timer);
            window.removeEventListener('pageshow', check);
            document.removeEventListener('visibilitychange', check);
        };
    }, [needsLogin, core]);

    const startLogin = useCallback(async () => {
        const started = await login();
        if (started.loggedIn) {
            setNeedsLogin(false);
            core.load();
        } else {
            // Amazon's own page, through the proxy on this device; coming back, the check above notices the session.
            window.location.href = started.url;
        }
    }, [core]);

    // ---- sort and filter choices

    const setPrefs = useCallback((tab, next) => {
        setPrefsState((current) => {
            const updated = { ...current, [tab]: { ...current[tab], ...next } };
            savePrefs(updated);
            return updated;
        });
    }, []);

    // Leaving while a change waits (undo window or in flight) would lose it.
    useEffect(() => {
        const warn = (e) => { if (core.store.saving()) e.preventDefault(); };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [core]);

    return {
        view: core.store.view,
        store: core.store,
        activity: core.activity,
        actions: core.actions,
        reload: () => core.load(),
        sync: core.store.saving() ? { state: 'saving', text: `Enregistrement (${core.store.saving()})…` } : sync,
        needsLogin,
        startLogin,
        prefs,
        setPrefs,
    };
}
