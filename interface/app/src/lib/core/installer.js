// Installing a downloaded update in the app: the page asks its server to download the APK (checked against the
// release's checksums), follows the download, then asks the app's native side to open Android's installer.
// Pure of the DOM and of Svelte: the native object, the server calls and the clock are passed in (tested in Node).
//
// The native side is MainActivity's WebMessageListener, which Android exposes to the page as a global object
// `alexaUpdater` (postMessage / onmessage) on http://127.0.0.1:3457 only. In a browser it does not exist.

/** The app's installer, or null outside the app. `ask(action)` resolves to its answer, or null after `timeoutMs`. */
export function nativeInstaller(host = globalThis, timeoutMs = 5000) {
    const port = host && host.alexaUpdater;
    if (!port || typeof port.postMessage !== 'function') return null;
    let queue = Promise.resolve();
    // One question at a time: the answers come back on a single onmessage, with nothing to tell them apart.
    const ask = (action) => {
        const answer = queue.then(() => new Promise((resolve) => {
            const timer = setTimeout(() => { port.onmessage = null; resolve(null); }, timeoutMs);
            port.onmessage = (event) => {
                clearTimeout(timer);
                port.onmessage = null;
                try {
                    resolve(JSON.parse(event.data));
                } catch {
                    resolve(null);
                }
            };
            port.postMessage(JSON.stringify({ action }));
        }));
        queue = answer.catch(() => {});
        return answer;
    };
    return { ask };
}

/**
 * Downloads then installs. `onProgress({ state, received, total, error })` follows it; resolves to what happened:
 * 'started' (Android's installer is open), 'needs-permission' (Android's setting to allow installs from this app is
 * open: try again after), or throws with the reason.
 *
 * @param {{ installer: { ask: (action: string) => Promise<any> }, start: () => Promise<any>, progress: () => Promise<any>,
 *   onProgress?: (p: any) => void, wait?: (ms: number) => Promise<void>, pollMs?: number }} options
 */
export async function downloadAndInstall({ installer, start, progress, onProgress = () => {}, wait = (ms) => new Promise((r) => setTimeout(r, ms)), pollMs = 1000 }) {
    let p = await start();
    onProgress(p);
    while (p.state === 'downloading' || p.state === 'verifying') {
        await wait(pollMs);
        p = await progress();
        onProgress(p);
    }
    if (p.state === 'error') throw new Error(p.error || 'download failed');
    if (p.state !== 'ready') throw new Error(`unexpected download state "${p.state}"`);
    const answer = await installer.ask('install');
    if (!answer) throw new Error('the app did not answer');
    if (answer.status === 'missing') throw new Error('the downloaded APK is not where the app expects it');
    return answer.status;
}
