import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { actionsOf, editedPhrases, idsOfName, phraseOwner, phrasesOf, targetName } from '../public/js/model.js';
import { explain } from '../public/js/toasts.js';

const routine = {
    automationId: 'r', name: 'on va dormir',
    triggers: [{ type: 'CustomUtterance', payload: JSON.stringify({ utterance: 'bonne nuit', utterances: ['bonne nuit', 'au dodo'] }) }],
    sequence: { startNode: { '@type': 'SerialNode', nodesToExecute: [
        { '@type': 'OpaquePayloadOperationNode', type: 'Alexa.SmartHome.Batch', operationPayload: '{"target":"tv","operations":[{"type":"turnOff"}]}' },
        { '@type': 'OpaquePayloadOperationNode', type: 'Alexa.Speak', operationPayload: { textToSpeak: 'bonne nuit' } },
        { '@type': 'OpaquePayloadOperationNode', type: 'Alexa.Notification', operationPayload: {} },
    ] } },
};

describe('page model', () => {
    it('reads phrases and actions, payloads given as strings included', () => {
        assert.deepEqual(phrasesOf(routine), ['bonne nuit', 'au dodo']);
        assert.deepEqual(actionsOf(structuredClone(routine)), [
            { target: 'tv', op: 'turnOff' }, { speak: 'bonne nuit' }, { type: 'Alexa.Notification' }]);
    });

    it('names devices and the "all the lights" group', () => {
        const names = new Map([['tv', 'Télé']]);
        assert.equal(targetName('tv', names), 'Télé');
        assert.equal(targetName('virtual@LIGHT@ACUSTOMER', names), 'toutes les lumières');
        assert.equal(targetName('gone', names), null);
    });

    it('finds who already answers to a phrase, the routine being edited aside', () => {
        assert.equal(phraseOwner([routine], 'AU DODO').name, 'on va dormir');
        assert.equal(phraseOwner([routine], 'au dodo', 'r'), null);
    });

    it('edits phrases the way the CLI does', () => {
        assert.deepEqual(editedPhrases(['a', 'b'], { add: ['A', 'c'], remove: ['b'] }), ['a', 'c']);
    });

    it('collects the ids of a device listed twice', () => {
        const view = { devices: [{ id: 'tv', displayName: 'Télé' }], appliances: [{ applianceId: 'AAA_tv', entityId: 'tv', friendlyName: 'Télé' }] };
        assert.deepEqual([...idsOfName(view, 'télé')].sort(), ['AAA_tv', 'tv']);
    });
});

describe('error messages', () => {
    for (const [cli, french] of [
        ['error: phrase already used by: pause télé', 'Phrase déjà utilisée par « pause télé ».'],
        ['still used by 2 routine(s): a, b (--force to delete anyway)', 'Encore utilisé par : a, b.'],
        ['not logged in: run "alexa-cli login" first', 'Non connecté à Amazon : lancez « alexa-cli login ».'],
        ['401 Unauthorized', 'Session Amazon expirée : relancez « alexa-cli login ».'],
        ['Failed to fetch', 'Serveur de l\'interface injoignable.'],
        ['something new', 'something new'],
        ['', 'Erreur inconnue.'],
    ]) {
        it(`says "${cli}" in French`, () => assert.equal(explain(cli), french));
    }
});
