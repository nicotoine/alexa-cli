// The toast's markup, on a minimal stand-in for the DOM (Node has none).

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

class FakeNode {
    constructor(tag) {
        this.tag = tag;
        this.children = [];
        this.attributes = {};
        this.listeners = {};
    }
    setAttribute(k, v) { this.attributes[k] = v; }
    addEventListener(type, fn) { this.listeners[type] = fn; }
    append(...nodes) { this.children.push(...nodes.map((n) => (n instanceof FakeNode ? n : String(n)))); }
    remove() { this.removed = true; }
    get textContent() { return this.children.map((c) => (typeof c === 'string' ? c : c.textContent)).join(''); }
}

let container;
beforeEach(() => {
    container = new FakeNode('div');
    globalThis.document = { createElement: (tag) => new FakeNode(tag), querySelector: () => container };
});
afterEach(() => { delete globalThis.document; });

describe('toast', () => {
    it('writes no "undefined" when there is no detail and no action', async () => {
        const { toast } = await import('../public/js/toasts.js');
        toast('« pause télé » désactivée', { type: 'success', duration: 0 });
        const [box] = container.children;
        assert.equal(box.textContent, '« pause télé » désactivée×');
        assert.equal(box.attributes.role, 'status');
    });

    it('shows the detail and an action button, and an error is an alert', async () => {
        const { toast } = await import('../public/js/toasts.js');
        let ran = false;
        toast('Échec', { type: 'error', detail: 'Phrase déjà utilisée.', action: { label: 'Réessayer', run: () => { ran = true; } }, duration: 0 });
        const [box] = container.children;
        assert.equal(box.attributes.role, 'alert');
        assert.equal(box.textContent, 'ÉchecPhrase déjà utilisée.Réessayer×');
        const button = box.children.find((c) => c.tag === 'button' && c.textContent === 'Réessayer');
        button.listeners.click();
        assert.equal(ran, true);
        assert.equal(box.removed, true, 'the toast closes when its action runs');
    });
});
