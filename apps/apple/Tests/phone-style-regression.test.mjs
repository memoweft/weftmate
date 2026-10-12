import {test} from 'node:test';
import assert from 'node:assert/strict';
import {systemAccent, checkPhoneStyle} from '../Scripts/check_phone_style.mjs';
test('system emphasis bypasses fail the phone style gate', () => {
 for (const value of ['Color.accentColor', 'UIColor.systemBlue', 'NSColor.controlAccentColor', '.tint(.blue)', '.foregroundStyle(.accentColor)', '.foregroundColor(.blue)']) assert.equal(systemAccent(value), true, value);
});
test('generated tokens and comments pass the phone style gate', () => {
 assert.equal(systemAccent('.tint(Weave.accent) // Color.blue'), false);
 assert.equal(systemAccent('/* Color.accentColor */ .foregroundStyle(AppleTokens.Colors.accent)'), false);
 assert.ok(checkPhoneStyle().checkedUIFiles > 90);
});
