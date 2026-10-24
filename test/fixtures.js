// Shapes taken from real Alexa answers, trimmed to what the code reads. Ids are made up.

export const CUSTOMER = 'ACUSTOMER0001';

export function voiceRoutine({ id, name, phrases, target, op = 'turnOn', status = 'ENABLED' }) {
    return {
        '@type': 'com.amazon.alexa.behaviors.model.Automation',
        automationId: `amzn1.alexa.automation.${id}`,
        name,
        status,
        owner: { '@type': 'OwnerId', ownerType: 'CUSTOMER', id: CUSTOMER },
        triggers: [{
            id: `amzn1.alexa.trigger.${id}`,
            type: 'CustomUtterance',
            skillId: 'amzn1.ask.1p.customutterance',
            payload: { customerId: CUSTOMER, utterance: phrases[0], utterances: phrases, locale: 'fr-FR', marketplaceId: 'A13V1IB3VIYZZH' },
        }],
        sequence: {
            '@type': 'com.amazon.alexa.behaviors.model.Sequence',
            startNode: {
                '@type': 'com.amazon.alexa.behaviors.model.OpaquePayloadOperationNode',
                type: 'Alexa.SmartHome.Batch',
                skillId: 'amzn1.ask.1p.smarthome',
                operationPayload: { target, customerId: CUSTOMER, operations: [{ type: op }] },
            },
        },
    };
}

// "on va dormir": several actions, one of them on a device, one "all the lights", one spoken.
export function bedtime(tvTarget) {
    const r = voiceRoutine({ id: 'bed', name: 'on va dormir', phrases: ['on va dormir', 'bonne nuit'], target: tvTarget, op: 'turnOff' });
    r.sequence.startNode = {
        '@type': 'com.amazon.alexa.behaviors.model.SerialNode',
        nodesToExecute: [
            { '@type': 'com.amazon.alexa.behaviors.model.OpaquePayloadOperationNode', type: 'Alexa.SmartHome.Batch', skillId: 'amzn1.ask.1p.smarthome',
                operationPayload: { target: tvTarget, customerId: CUSTOMER, operations: [{ type: 'turnOff' }] } },
            { '@type': 'com.amazon.alexa.behaviors.model.OpaquePayloadOperationNode', type: 'Alexa.SmartHome.Batch', skillId: 'amzn1.ask.1p.smarthome',
                operationPayload: { target: `virtual@LIGHT@${CUSTOMER}`, customerId: CUSTOMER, operations: [{ type: 'turnOff' }] } },
            { '@type': 'com.amazon.alexa.behaviors.model.OpaquePayloadOperationNode', type: 'Alexa.Speak', skillId: 'amzn1.ask.1p.saysomething',
                operationPayload: { textToSpeak: 'bonne nuit', customerId: CUSTOMER } },
        ],
    };
    return r;
}

export const ENTITIES = [
    { id: 'tv-ha', displayName: 'Télé' },
    { id: 'tv-pause', displayName: 'Télé pause' },
    { id: 'tv-tcl', displayName: 'Smart TV' },
];

const skillIdentity = (skillId) => ({ namespace: 'SKILL', identifier: Buffer.from(JSON.stringify({ skillId, stage: 'live' })).toString('base64') });

export const APPLIANCES = [
    { applianceId: 'AAA_SonarCloudService_tv', entityId: 'tv-ha', friendlyName: 'Télé', manufacturerName: 'riddix', applianceNetworkState: { reachability: 'REACHABLE' } },
    { applianceId: 'AAA_SonarCloudService_pause', entityId: 'tv-pause', friendlyName: 'Télé pause', manufacturerName: 'riddix' },
    { applianceId: 'SKILL_tcl_tv', entityId: 'tv-tcl', friendlyName: 'Smart TV', manufacturerName: 'TCL', driverIdentity: skillIdentity('amzn1.ask.skill.tcl') },
];

export function routines() {
    return [
        voiceRoutine({ id: 'pause', name: 'pause télé', phrases: ['pause télé', 'mets la télé en pause'], target: 'tv-pause' }),
        bedtime('tv-tcl'),
        voiceRoutine({ id: 'gone', name: 'réveil', phrases: ['réveil'], target: 'deleted-device' }),
    ];
}

/** A stand-in for AlexaClient that records what was written. */
export function fakeClient({ routineList = routines(), entities = ENTITIES, appliances = APPLIANCES } = {}) {
    const calls = [];
    return {
        calls,
        routineList,
        routines: async () => structuredClone(routineList),
        entities: async () => structuredClone(entities),
        appliances: async () => structuredClone(appliances),
        listedSkills: async () => [{ id: 'amzn1.ask.skill.radio', name: 'Radio France', type: 'MUSIC' }],
        echos: async () => [{ serialNumber: 'ECHO1', accountName: 'Salon', deviceFamily: 'ECHO', deviceType: 'A2TF17PFR55MTB' }],
        validate: async (type, payload) => {
            calls.push(['validate', type, payload]);
            return payload;
        },
        createRoutine: async (body) => {
            calls.push(['create', body]);
            return { automationId: 'amzn1.alexa.automation.new' };
        },
        updateRoutine: async (body) => calls.push(['update', body]),
        deleteRoutine: async (id) => calls.push(['delete', id]),
        deleteAppliance: async (id) => {
            calls.push(['forget', id]);
            appliances.splice(appliances.findIndex((a) => a.applianceId === id), 1);
        },
        runRoutine: async (serial, routine) => calls.push(['run', serial, routine.automationId]),
    };
}
