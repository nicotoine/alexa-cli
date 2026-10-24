import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    asciiJson, brokenRoutines, flattenEchos, checkPhrasesFree, customerIdOf, editedPhrases, findByName, findRoutine, flattenAppliances,
    idsOfName, mergeSkills, phrasesOf, rebuildBody, routineTargets, routineTargetsList, skillIdOf, utteranceTrigger, writeBody,
} from '../src/model.js';
import { APPLIANCES, CUSTOMER, ENTITIES, bedtime, routines } from './fixtures.js';

describe('asciiJson', () => {
    it('escapes accents so Amazon cannot store "tÃ©lÃ©"', () => {
        const text = asciiJson({ phrase: 'pause télé' });
        assert.equal(text, '{"phrase":"pause t\\u00e9l\\u00e9"}');
        assert.match(text, /^[\x00-\x7f]*$/);
        assert.equal(JSON.parse(text).phrase, 'pause télé');
    });

    it('survives JSON nested as a string, as the write format does', () => {
        const body = { triggerJson: JSON.stringify({ payload: JSON.stringify({ utterance: 'télé' }) }) };
        const back = JSON.parse(JSON.parse(JSON.parse(asciiJson(body)).triggerJson).payload);
        assert.equal(back.utterance, 'télé');
    });
});

describe('reading routines', () => {
    it('lists every phrase, from a decoded or a string payload', () => {
        const [pause] = routines();
        assert.deepEqual(phrasesOf(pause), ['pause télé', 'mets la télé en pause']);
        pause.triggers[0].payload = JSON.stringify(pause.triggers[0].payload);
        assert.deepEqual(phrasesOf(pause), ['pause télé', 'mets la télé en pause']);
    });

    it('finds a routine by name, phrase (any case) or id, and refuses an ambiguous key', () => {
        const list = routines();
        assert.equal(findRoutine(list, 'Mets la télé en pause').name, 'pause télé');
        assert.equal(findRoutine(list, 'amzn1.alexa.automation.bed').name, 'on va dormir');
        assert.throws(() => findRoutine(list, 'nope'), /no routine matches/);
        list.push(structuredClone(list[0]));
        assert.throws(() => findRoutine(list, 'pause télé'), /matches 2 routines/);
    });

    it('keeps device targets and leaves out placeholders such as "all the lights"', () => {
        assert.deepEqual(routineTargets(bedtime('tv-tcl')), [{ target: 'tv-tcl', op: 'turnOff' }]);
    });

    it('reads the customer id from the routines', () => {
        assert.equal(customerIdOf(routines()), CUSTOMER);
        assert.throws(() => customerIdOf([]), /customer id/);
    });

    it('refuses a phrase another routine already answers to, but not the routine being edited', () => {
        const list = routines();
        assert.throws(() => checkPhrasesFree(list, ['PAUSE TÉLÉ']), /already used by: pause télé/);
        assert.doesNotThrow(() => checkPhrasesFree(list, ['pause télé'], list[0]));
    });

    it('adds and removes phrases without duplicates', () => {
        assert.deepEqual(editedPhrases(['a', 'b'], { add: ['B', 'c'], remove: ['A'] }), ['b', 'c']);
    });
});

describe('devices and skills', () => {
    it('matches a device by name or id and says when it is ambiguous', () => {
        assert.equal(findByName(ENTITIES, 'télé').id, 'tv-ha');
        assert.equal(findByName(ENTITIES, 'tv-tcl').displayName, 'Smart TV');
        assert.throws(() => findByName([...ENTITIES, { id: 'x', displayName: 'Télé' }], 'Télé'), /2 devices/);
    });

    it('collects every id of a device listed both as entity and appliance', () => {
        assert.deepEqual([...idsOfName([ENTITIES, APPLIANCES], 'Smart TV')].sort(), ['SKILL_tcl_tv', 'tv-tcl']);
    });

    it('finds appliances wherever they are nested', () => {
        const nested = { locationDetails: { a: { amazonBridgeDetails: { b: { applianceDetails: { x: APPLIANCES[0] } } } } } };
        assert.deepEqual(flattenAppliances(nested), [APPLIANCES[0]]);
    });

    it('decodes the skill behind a device and adds skills Amazon does not list', () => {
        assert.equal(skillIdOf(APPLIANCES[2]), 'amzn1.ask.skill.tcl');
        assert.equal(skillIdOf(APPLIANCES[0]), null);
        const merged = mergeSkills([{ id: 'amzn1.ask.skill.radio', name: 'Radio France', type: 'MUSIC' }], APPLIANCES);
        assert.deepEqual(merged.map((s) => [s.name, s.devices.length, s.listed]), [['TCL', 1, false], ['Radio France', 0, true]]);
    });
});

describe('echos', () => {
    it('adds the unnamed Alexa apps listed inside another device, once each', () => {
        const echos = flattenEchos([
            { serialNumber: 'E1', accountName: 'Salon', appDeviceList: [] },
            { serialNumber: 'APP-SELF', accountName: 'This Device', appDeviceList: [
                { serialNumber: 'PHONE', deviceType: 'A2TF17PFR55MTB', deviceAccountId: 'ACC' },
                { serialNumber: 'APP-SELF', deviceType: 'A2IVLV5VM2W81' },
            ] },
        ]);
        assert.deepEqual(echos.map((e) => [e.serialNumber, e.accountName]), [['E1', 'Salon'], ['APP-SELF', 'This Device'], ['PHONE', null]]);
    });
});

describe('audit', () => {
    it('reports routines whose device is gone, and only those', () => {
        const broken = brokenRoutines(routines(), ENTITIES, APPLIANCES);
        assert.deepEqual(broken.map((b) => [b.name, b.missing.map((m) => m.target)]), [['réveil', ['deleted-device']]]);
    });
});

describe('writing routines', () => {
    it('builds the flat write body with JSON-string fields and a double-encoded trigger payload', () => {
        const body = writeBody({ name: 'n', status: 'ENABLED', triggers: [utteranceTrigger(['a', 'b'], CUSTOMER)], sequence: { s: 1 } });
        assert.equal(typeof body.triggerJson, 'string');
        assert.deepEqual(body.triggerJsonList, [body.triggerJson]);
        const trigger = JSON.parse(body.triggerJson);
        assert.equal(trigger.skillId, null);
        const payload = JSON.parse(trigger.payload);
        assert.deepEqual([payload.utterance, payload.utterances, payload.customerId], ['a', ['a', 'b'], CUSTOMER]);
        assert.equal(body.behaviorId, undefined);
    });

    it('rebuilds a routine with its id, re-validating every action, and edits only what it is told to', async () => {
        const seen = [];
        const routine = bedtime('tv-tcl');
        const body = await rebuildBody(routine, {
            editAction: (p) => (p.target === 'tv-tcl' ? { ...p, target: 'tv-ha' } : p),
        }, async (type, p) => (seen.push(type), p));
        assert.equal(body.behaviorId, 'amzn1.alexa.automation.bed');
        assert.deepEqual(seen, ['Alexa.SmartHome.Batch', 'Alexa.SmartHome.Batch', 'Alexa.Speak']);
        const nodes = JSON.parse(body.sequenceJson).startNode.nodesToExecute.map((n) => n.operationPayload.target || n.operationPayload.textToSpeak);
        assert.deepEqual(nodes, ['tv-ha', `virtual@LIGHT@${CUSTOMER}`, 'bonne nuit']);
        assert.deepEqual(JSON.parse(JSON.parse(body.triggerJson).payload).utterances, ['on va dormir', 'bonne nuit']);
        assert.equal(routine.sequence.startNode.nodesToExecute[0].operationPayload.target, 'tv-tcl', 'the routine read is left untouched');
    });

    it('keeps the status unless asked to change it', async () => {
        const [pause] = routines();
        const same = await rebuildBody(pause, {}, async (t, p) => p);
        const off = await rebuildBody(pause, { status: 'DISABLED' }, async (t, p) => p);
        assert.deepEqual([same.status, off.status], ['ENABLED', 'DISABLED']);
    });

    it('refuses a routine without trigger', async () => {
        await assert.rejects(rebuildBody({ triggers: [] }, {}, async (t, p) => p), /no trigger/);
    });
});

describe('routineTargetsList', () => {
    it('adds the appliances not yet listed as entities, under their entity id, without doubles', () => {
        const fresh = { applianceId: 'AAA_new', entityId: 'new-entity', friendlyName: 'Aspirateur base' };
        const list = routineTargetsList(ENTITIES, [...APPLIANCES, fresh, { applianceId: 'AAA_noentity', friendlyName: 'Sans entité' }]);
        assert.equal(list.length, ENTITIES.length + 1);
        assert.deepEqual(list.at(-1), { id: 'new-entity', displayName: 'Aspirateur base' });
        assert.equal(findByName(list, 'Télé').id, 'tv-ha');
    });
});
