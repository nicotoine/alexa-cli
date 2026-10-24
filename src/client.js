// The Alexa app's API, through alexa-remote2 (which owns the Amazon login and the cookie/CSRF handling). Every
// network call of the CLI goes through this class.

import AlexaRemote from 'alexa-remote2';
import { loadAuth, loginDoneHtml, saveAuth, PROXY_PORT } from './auth.js';
import { asciiJson, flattenAppliances, flattenEchos, LOCALE } from './model.js';

// The Alexa app version the write endpoints expect (as sent by alexa-mcp). Without it writes are refused.
const ROUTINES_VERSION = '3.0.264101';
const WRITE_HEADERS = { 'Content-Type': 'application/json', 'Routines-Version': ROUTINES_VERSION };
const TIMEOUT_MS = 30000;

export class NotLoggedIn extends Error {
    constructor() {
        super('not logged in: run "alexa-cli login" first');
    }
}

/**
 * Connects with the stored tokens. With `interactive`, a missing or dead session starts the login proxy on
 * 127.0.0.1 and `onLoginUrl(url)` is told where to sign in; the promise resolves once Amazon has accepted it.
 */
export function connect({ interactive = false, onLoginUrl = () => {}, debug = false } = {}) {
    const former = loadAuth();
    if (!former && !interactive) return Promise.reject(new NotLoggedIn());
    const remote = new AlexaRemote();
    return new Promise((resolve, reject) => {
        remote.on('cookie', () => {
            if (remote.cookieData) saveAuth(remote.cookieData);
        });
        remote.init({
            cookie: former || undefined,
            formerRegistrationData: former || undefined,
            amazonPage: 'amazon.fr',
            alexaServiceHost: 'alexa.amazon.fr',
            acceptLanguage: LOCALE,
            amazonPageProxyLanguage: 'fr_FR',
            setupProxy: true,
            proxyOwnIp: '127.0.0.1',
            proxyPort: PROXY_PORT,
            proxyListenBind: '127.0.0.1',
            proxyCloseWindowHTML: loginDoneHtml(),
            useWsMqtt: false,
            usePushConnection: false,
            notifications: false,
            bluetooth: false,
            cookieRefreshInterval: 0,
            // Truncated: alexa-remote2 logs whole answers, account address included.
            logger: debug ? (m) => process.stderr.write(`${String(m).slice(0, 300)}\n`) : undefined,
        }, (err) => {
            if (err) {
                if (interactive && String(err.message || err).includes(`:${PROXY_PORT}`)) {
                    return onLoginUrl(`http://127.0.0.1:${PROXY_PORT}/`);
                }
                return reject(err);
            }
            if (remote.cookieData) saveAuth(remote.cookieData);
            resolve(new AlexaClient(remote));
        });
    });
}

export class AlexaClient {
    constructor(remote) {
        this.remote = remote;
    }

    request(path, flags = {}) {
        return new Promise((resolve, reject) => {
            this.remote.httpsGet(path, (err, res) => (err ? reject(err) : resolve(res)), { timeout: TIMEOUT_MS, ...flags });
        });
    }

    write(method, path, body) {
        return this.request(path, { method, headers: WRITE_HEADERS, data: asciiJson(body) });
    }

    callback(fn) {
        return new Promise((resolve, reject) => fn((err, res) => (err ? reject(err) : resolve(res))));
    }

    // ---- reads

    async routines() {
        const res = await this.request('/api/behaviors/v2/automations?limit=2000');
        return Array.isArray(res) ? res : [];
    }

    // The devices a routine can target, with the id routines use.
    async entities() {
        const res = await this.request('/api/behaviors/entities?skillId=amzn1.ask.1p.smarthome');
        return Array.isArray(res) ? res : [];
    }

    // Every smart-home device with its source, skill and reachability.
    async appliances() {
        return flattenAppliances(await this.callback((cb) => this.remote.getSmarthomeDevices(cb)));
    }

    // Amazon's "your skills" page (slow, and incomplete for smart-home skills: see mergeSkills).
    async listedSkills() {
        return (await this.callback((cb) => this.remote.getSkills(cb)).catch(() => [])) || [];
    }

    // Echos, Fire TVs and the Alexa app on each phone (see flattenEchos).
    async echos() {
        return flattenEchos(((await this.callback((cb) => this.remote.getDevices(cb))) || {}).devices || []);
    }

    // ---- writes

    /** The action as Amazon normalises it. Smart-home actions come back VALID with no payload: keep ours. */
    async validate(type, operationPayload) {
        const res = await this.request('/api/behaviors/operation/validate', {
            method: 'POST',
            headers: WRITE_HEADERS,
            data: asciiJson({ type, operationPayload: JSON.stringify(operationPayload) }),
        });
        if (res && res.result && res.result !== 'VALID') throw new Error(`Alexa rejected the ${type} action: ${JSON.stringify(res)}`);
        let normalised = res && res.operationPayload;
        if (typeof normalised === 'string') normalised = JSON.parse(normalised);
        return normalised || operationPayload;
    }

    // Never retried: a lost answer to a create that went through would duplicate the routine.
    async createRoutine(body) {
        const res = await this.write('POST', '/api/behaviors/automations', body);
        if (!res || !res.automationId) throw new Error(`Alexa did not create the routine: ${(res && res.message) || JSON.stringify(res)}`);
        return res;
    }

    async updateRoutine(body) {
        const res = await this.write('PUT', `/api/behaviors/automations/${encodeURIComponent(body.behaviorId)}`, body);
        if (res && res.message) throw new Error(`Alexa did not update the routine: ${res.message}`);
    }

    // The read side is /v2/automations, but writes and deletes only exist without "v2" (a v2 POST answers 404).
    deleteRoutine(automationId) {
        return this.request(`/api/behaviors/automations/${encodeURIComponent(automationId)}`, { method: 'DELETE' });
    }

    // The id holds # / = and must be encoded, or the DELETE silently does nothing (alexa-mcp).
    deleteAppliance(applianceId) {
        return this.request(`/api/phoenix/appliance/${encodeURIComponent(applianceId)}`, { method: 'DELETE' });
    }

    runRoutine(echoSerial, routine) {
        return this.callback((cb) => this.remote.executeAutomationRoutine(echoSerial, routine, cb));
    }
}
