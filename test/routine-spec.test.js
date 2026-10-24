import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SpecError, checkSpec, fromSpec, toSpec, writeSpecBody } from '../src/routine-spec.js';
import { APPLIANCES, CUSTOMER, ENTITIES, bedtime, routines } from './fixtures.js';

const ECHOS = [
    { serialNumber: 'ECHO-SALON', accountName: 'Salon', deviceType: 'A2TF17PFR55MTB', deviceFamily: 'ECHO' },
    { serialNumber: 'FTV-1', accountName: 'Fire tv', deviceType: 'AFTKA', deviceAccountId: 'FTV-ACCOUNT' },
    { serialNumber: '4fc11af7PHONE', accountName: null, deviceType: 'A2TF17PFR55MTB', deviceFamily: 'ALEXA_APP' },
];
// Reading names ids from both lists; writing resolves names on the routine entities only (a device is listed
// twice, and a routine targets the entity id).
const readLists = { devices: [...ENTITIES, ...APPLIANCES], echos: ECHOS };
const lists = { devices: ENTITIES, echos: ECHOS, customerId: CUSTOMER };

// The routine made in the Alexa app to learn the schedule format (trimmed): every day but Monday at 11:29,
// "bonjour" on a named Echo.
const scheduled = {
    automationId: 'amzn1.alexa.automation.sched',
    name: 'Dimanche, Mardi, … à 11:29 AM',
    status: 'ENABLED',
    triggers: [{
        type: 'AbsoluteTimeSchedule', skillId: 'amzn1.ask.1p.routines.schedule',
        payload: { schedule: { '@type': 'RRULE', triggerTime: '112900', triggerTimes: ['112900'], timeZoneId: 'Europe/Paris',
            recurrence: 'RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=SU,TU,WE,TH,FR,SA' }, customer: { '@id': CUSTOMER, '@type': 'ac:Person' } },
    }],
    sequence: { '@type': 'com.amazon.alexa.behaviors.model.Sequence', startNode: {
        '@type': 'com.amazon.alexa.behaviors.model.OpaquePayloadOperationNode', type: 'Alexa.GoodMorning.Play', skillId: 'amzn1.ask.1p.saysomething',
        operationPayload: { customerId: CUSTOMER, deviceType: 'A2TF17PFR55MTB', deviceSerialNumber: 'ECHO-SALON', locale: 'fr-FR' } } },
};

describe('reading a routine as a spec', () => {
    it('reads phrases and a device action, with device names', () => {
        assert.deepEqual(toSpec(routines()[0], readLists), {
            name: 'pause télé', enabled: true, when: { say: ['pause télé', 'mets la télé en pause'] },
            do: [{ device: 'Télé pause', turn: 'on' }],
        });
    });

    it('reads several steps, a group placeholder and speech on the Echo that heard', () => {
        const spec = toSpec(bedtime('tv-tcl'), readLists);
        assert.deepEqual(spec.do, [
            { device: 'Smart TV', turn: 'off' },
            { device: `virtual@LIGHT@${CUSTOMER}`, turn: 'off' },
            { say: 'bonne nuit' },
        ]);
    });

    it('reads the schedule the Alexa app writes, days and Echo included', () => {
        assert.deepEqual(toSpec(scheduled, readLists), {
            name: 'Dimanche, Mardi, … à 11:29 AM', enabled: true,
            when: { at: '11:29', days: ['SU', 'TU', 'WE', 'TH', 'FR', 'SA'], timezone: 'Europe/Paris' },
            do: [{ play: 'goodmorning', on: 'Salon' }],
        });
    });

    it('keeps an action it does not know as raw', () => {
        const r = routines()[0];
        r.sequence.startNode = { '@type': 'x.OpaquePayloadOperationNode', type: 'Alexa.Music.PlaySearchPhrase', skillId: 'amzn1.ask.1p.music', operationPayload: { q: 'jazz' } };
        assert.deepEqual(toSpec(r, readLists).do, [{ raw: { type: 'Alexa.Music.PlaySearchPhrase', skillId: 'amzn1.ask.1p.music', payload: { q: 'jazz' } } }]);
    });
});

describe('round trip', () => {
    for (const [label, routine] of [['voice', routines()[0]], ['several steps', bedtime('tv-tcl')], ['schedule', scheduled]]) {
        it(`loses nothing: ${label}`, () => {
            const spec = toSpec(routine, readLists);
            assert.deepEqual(toSpec(fromSpec(spec, lists), readLists), spec);
        });
    }
});

describe('writing a spec', () => {
    const spec = {
        name: 'bonne nuit',
        when: { say: ['bonne nuit', 'au dodo'] },
        do: [
            { device: 'Télé', turn: 'off' },
            { together: [{ device: 'Télé pause', turn: 'on' }, { say: 'Bonne nuit', on: 'Salon' }] },
            { wait: 10 },
            { play: 'weather' },
            { command: 'mets de la musique douce', on: 'Salon' },
            { fireTv: 'off', on: 'Fire tv' },
        ],
    };

    it('builds a flat sequence in order, groups dissolved, names resolved', () => {
        const routine = fromSpec(spec, lists);
        const nodes = routine.sequence.startNode.nodesToExecute;
        assert.match(routine.sequence.startNode['@type'], /SerialNode$/);
        assert.deepEqual(nodes.map((n) => n.type), ['Alexa.SmartHome.Batch', 'Alexa.SmartHome.Batch', 'Alexa.Speak', 'Alexa.System.Wait',
            'Alexa.Weather.Play', 'Alexa.TextCommand', 'Alexa.Operation.FireTV.TurnOff']);
        assert.deepEqual(nodes[0].operationPayload, { target: 'tv-ha', customerId: CUSTOMER, operations: [{ type: 'turnOff' }], locale: 'fr-FR' });
        assert.deepEqual(nodes[2].operationPayload,
            { customerId: CUSTOMER, deviceType: 'A2TF17PFR55MTB', deviceSerialNumber: 'ECHO-SALON', locale: 'fr-FR', textToSpeak: 'Bonne nuit' });
        assert.deepEqual(nodes[3].operationPayload, { waitTimeInSeconds: 10 });
        assert.equal(nodes[4].operationPayload.deviceSerialNumber, 'ALEXA_CURRENT_DSN', 'no "on": the Echo that heard answers');
        assert.equal(nodes[5].operationPayload.text, 'mets de la musique douce');
        assert.deepEqual(nodes[6].operationPayload, { customerId: CUSTOMER, deviceAccountId: 'FTV-ACCOUNT' });
        assert.equal(routine.status, 'ENABLED');
        assert.deepEqual(routine.triggers[0].payload.utterances, ['bonne nuit', 'au dodo']);
    });

    it('reads Amazon\'s groups back as the flat list they were made from', () => {
        // What Amazon stored for [device, device, wait, say] on a real account.
        const stored = routines()[0];
        stored.sequence.startNode = { '@type': 'x.SerialNode', nodesToExecute: [
            { '@type': 'x.ParallelNode', nodesToExecute: [
                { '@type': 'x.OpaquePayloadOperationNode', type: 'Alexa.SmartHome.Batch', operationPayload: { target: 'tv-ha', operations: [{ type: 'turnOn' }] } },
                { '@type': 'x.OpaquePayloadOperationNode', type: 'Alexa.SmartHome.Batch', operationPayload: { target: 'tv-pause', operations: [{ type: 'turnOn' }] } },
                { '@type': 'x.OpaquePayloadOperationNode', type: 'Alexa.System.Wait', operationPayload: { waitTimeInSeconds: 1 } },
            ] },
            { '@type': 'x.OpaquePayloadOperationNode', type: 'Alexa.Speak', operationPayload: { textToSpeak: 'c', deviceSerialNumber: 'ALEXA_CURRENT_DSN' } },
        ] };
        assert.deepEqual(toSpec(stored, readLists).do, [
            { device: 'Télé', turn: 'on' }, { device: 'Télé pause', turn: 'on' }, { wait: 1 }, { say: 'c' }]);
    });

    it('writes a schedule the way the Alexa app does', () => {
        const routine = fromSpec({ when: { at: '07:05', days: ['MO', 'FR'] }, do: [{ play: 'goodmorning', on: 'Salon' }] }, lists);
        const { schedule } = routine.triggers[0].payload;
        assert.deepEqual([schedule.triggerTime, schedule.triggerTimes, schedule.recurrence, schedule.timeZoneId],
            ['070500', ['070500'], 'RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,FR', 'Europe/Paris']);
        assert.equal(routine.name, 'routine 07:05');
    });

    it('validates every action and encodes the triggers as Amazon reads them', async () => {
        const validated = [];
        const body = await writeSpecBody(fromSpec(spec, lists), async (type, p) => (validated.push(type), p), 'amzn1.alexa.automation.x');
        assert.equal(validated.length, 7);
        assert.equal(body.behaviorId, 'amzn1.alexa.automation.x');
        assert.equal(typeof JSON.parse(body.triggerJson).payload, 'string');
        assert.equal(body.conditionJson, undefined);
    });

    it('targets an unnamed Alexa app by its serial number, both ways', () => {
        const spec = { when: { at: '11:29' }, do: [{ play: 'goodmorning', on: '4fc11af7PHONE' }] };
        const routine = fromSpec(spec, lists);
        assert.deepEqual([routine.sequence.startNode.operationPayload.deviceSerialNumber, routine.sequence.startNode.operationPayload.deviceType],
            ['4fc11af7PHONE', 'A2TF17PFR55MTB']);
        assert.deepEqual(toSpec(routine, readLists).do, [{ play: 'goodmorning', on: '4fc11af7PHONE' }]);
    });

    it('fails on an unknown device or Echo, naming it', () => {
        assert.throws(() => fromSpec({ when: { say: ['x'] }, do: [{ device: 'Nope', turn: 'on' }] }, lists), /no device is named "Nope"/);
        assert.throws(() => fromSpec({ when: { say: ['x'] }, do: [{ say: 'hi', on: 'Cuisine' }] }, lists), /no Echo is named "Cuisine"/);
    });
});

describe('checking a spec', () => {
    for (const [spec, message] of [
        [{ do: [{ wait: 1 }] }, /"when" is missing/],
        [{ when: { say: [] }, do: [{ wait: 1 }] }, /at least one phrase/],
        [{ when: { at: '7:5' }, do: [{ wait: 1 }] }, /HH:MM/],
        [{ when: { at: '07:05', days: ['LU'] }, do: [{ wait: 1 }] }, /"LU"/],
        [{ when: { say: ['x'] }, do: [] }, /at least one step/],
        [{ when: { say: ['x'] }, do: [{ wait: 1, say: 'a' }] }, /exactly one of/],
        [{ when: { say: ['x'] }, do: [{ device: 'Télé' }] }, /"turn": "on" or "off"/],
        [{ when: { say: ['x'] }, do: [{ wait: 0 }] }, /1 to 3600/],
        [{ when: { say: ['x'] }, do: [{ play: 'music' }] }, /play must be one of/],
        [{ when: { say: ['x'] }, do: [{ together: [{ say: '' }] }] }, /do\[0\]\.together\[0\]\.say needs a text/],
        [{ when: { at: '07:00' }, do: [{ say: 'bonjour' }] }, /needs "on": a scheduled routine/],
    ]) {
        it(`refuses ${JSON.stringify(spec).slice(0, 60)}`, () => {
            assert.throws(() => checkSpec(spec), (e) => e instanceof SpecError && message.test(e.message));
        });
    }
});
