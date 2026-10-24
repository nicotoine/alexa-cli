import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loginDoneHtml } from '../src/auth.js';

describe('loginDoneHtml', () => {
    it('says to close the tab when no interface is waiting', () => {
        const html = loginDoneHtml('');
        assert.match(html, /Connecté à Amazon/);
        assert.match(html, /fermer cet onglet/);
        assert.doesNotMatch(html, /refresh/);
    });

    it('goes back to the interface by itself when one is waiting', () => {
        const html = loginDoneHtml('http://127.0.0.1:3457/');
        assert.match(html, /<meta http-equiv="refresh" content="1; url=http:\/\/127\.0\.0\.1:3457\/">/);
        assert.match(html, /<a href="http:\/\/127\.0\.0\.1:3457\/">/);
    });

    it('escapes the address', () => {
        assert.doesNotMatch(loginDoneHtml('http://x/"><script>'), /<script>/);
    });
});
