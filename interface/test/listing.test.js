import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deviceFacets, deviceRows, nextDeviceSort, routineDevices, routineRows, skillRows, skillTypes } from '../app/src/lib/listing.js';
import { DEFAULTS, loadPrefs, savePrefs } from '../app/src/lib/prefs.js';

const routine = (id, { status = 'ENABLED', phrases = [id], target, trigger = 'CustomUtterance' } = {}) => ({
    automationId: id, name: id, status,
    triggers: [{ type: trigger, payload: { utterance: phrases[0], utterances: phrases } }],
    sequence: target ? { startNode: { '@type': 'OpaquePayloadOperationNode', operationPayload: { target, operations: [{ type: 'turnOn' }] } } } : {},
});

const view = {
    routines: [
        routine('éteint la télé', { target: 'tv', phrases: ['éteint la télé', 'coupe la télé', 'arrête la télé'] }),
        routine('Allume le bureau', { status: 'DISABLED', target: 'desk' }),
        routine('bonjour', { trigger: 'Alarm' }),
        routine('réveil', { target: 'gone' }),
    ],
    devices: [{ id: 'tv', displayName: 'Télé' }, { id: 'desk', displayName: 'Bureau' }],
    appliances: [
        { applianceId: 'AAA_tv', entityId: 'tv', friendlyName: 'Télé', manufacturerName: 'riddix' },
        { applianceId: 'AAA_desk', entityId: 'desk', friendlyName: 'Bureau', manufacturerName: 'riddix' },
        { applianceId: 'SKILL_plug', friendlyName: 'activer l\'alarme', manufacturerName: 'tapo' },
    ],
    audit: [{ automationId: 'réveil', name: 'réveil', missing: [{ target: 'gone' }] }],
    skills: [
        { id: 's1', name: 'Radio France', type: 'MUSIC', devices: [] },
        { id: 's2', name: 'tapo', type: 'SMART_HOME', devices: [{ name: 'a' }, { name: 'b' }] },
        { id: 's3', name: 'Ring', type: 'SMART_HOME', devices: [{ name: 'portail' }] },
    ],
};

const names = (rows) => rows.map((x) => x.r.automationId);

describe('routines', () => {
    it('sorts by name the French way: case and accents do not scatter the list', () => {
        assert.deepEqual(names(routineRows(view)), ['Allume le bureau', 'bonjour', 'éteint la télé', 'réveil']);
        assert.deepEqual(names(routineRows(view, { sort: 'name-desc' })), ['réveil', 'éteint la télé', 'bonjour', 'Allume le bureau']);
    });

    it('puts active routines first, then by name', () => {
        assert.deepEqual(names(routineRows(view, { sort: 'status' })), ['bonjour', 'éteint la télé', 'réveil', 'Allume le bureau']);
    });

    it('sorts by number of phrases and by device, routines without a device last', () => {
        assert.equal(names(routineRows(view, { sort: 'phrases' }))[0], 'éteint la télé');
        assert.deepEqual(names(routineRows(view, { sort: 'device' })), ['Allume le bureau', 'éteint la télé', 'bonjour', 'réveil']);
    });

    it('filters on status, trigger, device and broken references, and combines them', () => {
        assert.deepEqual(names(routineRows(view, { status: 'DISABLED' })), ['Allume le bureau']);
        assert.deepEqual(names(routineRows(view, { trigger: 'other' })), ['bonjour']);
        assert.deepEqual(names(routineRows(view, { device: 'Télé' })), ['éteint la télé']);
        assert.deepEqual(names(routineRows(view, { broken: true })), ['réveil']);
        assert.deepEqual(names(routineRows(view, { status: 'ENABLED', trigger: 'voice', text: 'coupe' })), ['éteint la télé']);
    });

    it('lists the devices routines act on, for the device filter', () => {
        assert.deepEqual(routineDevices(view), ['Bureau', 'Télé']);
    });

    it('copes with lists not loaded yet', () => {
        assert.deepEqual(routineRows({ routines: null }), []);
    });
});

describe('devices', () => {
    const order = (rows) => rows.map((x) => x.a.friendlyName);

    it('sorts by any column, both ways', () => {
        assert.deepEqual(order(deviceRows(view)), ['activer l\'alarme', 'Bureau', 'Télé']);
        assert.deepEqual(order(deviceRows(view, { sort: 'name', dir: 'desc' })), ['Télé', 'Bureau', 'activer l\'alarme']);
        assert.deepEqual(order(deviceRows(view, { sort: 'source' })), ['Bureau', 'Télé', 'activer l\'alarme']);
        // tapo before riddix, and the two riddix devices still in name order: the direction is the column's only.
        assert.deepEqual(order(deviceRows(view, { sort: 'maker', dir: 'desc' })), ['activer l\'alarme', 'Bureau', 'Télé']);
    });

    it('counts the routines using a device and filters on it', () => {
        const rows = deviceRows(view, { sort: 'routines', dir: 'desc' });
        assert.deepEqual(rows.map((x) => [x.a.friendlyName, x.refs]), [['Bureau', ['Allume le bureau']], ['Télé', ['éteint la télé']], ['activer l\'alarme', []]]);
        assert.deepEqual(order(deviceRows(view, { used: 'no' })), ['activer l\'alarme']);
    });

    it('filters on source and maker', () => {
        assert.deepEqual(order(deviceRows(view, { source: 'Skill' })), ['activer l\'alarme']);
        assert.deepEqual(order(deviceRows(view, { maker: 'riddix' })), ['Bureau', 'Télé']);
        assert.deepEqual(deviceFacets(view), { sources: ['Matter', 'Skill'], makers: ['riddix', 'tapo'] });
    });

    it('flips the direction on the same column and starts ascending on another', () => {
        assert.deepEqual(nextDeviceSort({ sort: 'name', dir: 'asc' }, 'name').dir, 'desc');
        assert.deepEqual(nextDeviceSort({ sort: 'name', dir: 'desc' }, 'maker'), { ...DEFAULTS.devices, sort: 'maker', dir: 'asc' });
    });
});

describe('skills', () => {
    it('puts the skills with most devices first, or sorts by name', () => {
        assert.deepEqual(skillRows(view).map((s) => s.name), ['tapo', 'Ring', 'Radio France']);
        assert.deepEqual(skillRows(view, { sort: 'name-asc' }).map((s) => s.name), ['Radio France', 'Ring', 'tapo']);
    });

    it('filters on type and on having devices', () => {
        assert.deepEqual(skillRows(view, { type: 'MUSIC' }).map((s) => s.name), ['Radio France']);
        assert.deepEqual(skillRows(view, { withDevices: true }).map((s) => s.name), ['tapo', 'Ring']);
        assert.deepEqual(skillTypes(view), ['MUSIC', 'SMART_HOME']);
    });
});

describe('saved choices', () => {
    const memory = (initial = {}) => {
        const data = { ...initial };
        return { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = v; }, data };
    };

    it('round-trips through storage', () => {
        const storage = memory();
        savePrefs({ ...DEFAULTS, routines: { ...DEFAULTS.routines, sort: 'status', broken: true } }, storage);
        assert.equal(loadPrefs(storage).routines.sort, 'status');
        assert.equal(loadPrefs(storage).routines.broken, true);
    });

    it('starts from the defaults when storage is missing, broken or throws', () => {
        assert.deepEqual(loadPrefs(memory()), DEFAULTS);
        assert.deepEqual(loadPrefs(memory({ 'alexa-cli.prefs.v1': '{nope' })), DEFAULTS);
        assert.deepEqual(loadPrefs({ getItem: () => { throw new Error('blocked'); } }), DEFAULTS);
        assert.doesNotThrow(() => savePrefs(DEFAULTS, { setItem: () => { throw new Error('quota'); } }));
    });

    it('ignores unknown keys and values of the wrong type', () => {
        const storage = memory({ 'alexa-cli.prefs.v1': JSON.stringify({ routines: { sort: 'status', broken: 'yes', evil: 1 }, hack: {} }) });
        const prefs = loadPrefs(storage);
        assert.equal(prefs.routines.sort, 'status');
        assert.equal(prefs.routines.broken, false);
        assert.equal('evil' in prefs.routines, false);
        assert.equal('hack' in prefs, false);
    });
});
