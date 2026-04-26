import { test, expect } from 'bun:test';
import { ALL_PERSONAS, PERSONA_TOOLS } from '../../src/opencode/personas.js';

test('PERSONA_TOOLS covers every persona in ALL_PERSONAS', () => {
  for (const p of ALL_PERSONAS) {
    expect(PERSONA_TOOLS[p]).toBeDefined();
    expect(PERSONA_TOOLS[p].read).toBe(true);
    expect(PERSONA_TOOLS[p].write).toBe(true);
  }
});

test('only the developer can edit existing files', () => {
  for (const p of ALL_PERSONAS) {
    const expected = p === 'developer';
    expect(PERSONA_TOOLS[p].edit).toBe(expected);
  }
});

test('only architect, developer, tester, pusher can run bash', () => {
  const bashAllowed = new Set(['architect', 'developer', 'tester', 'pusher']);
  for (const p of ALL_PERSONAS) {
    expect(PERSONA_TOOLS[p].bash).toBe(bashAllowed.has(p));
  }
});

test('only researcher and debate-* can use webfetch', () => {
  const webfetchAllowed = new Set(['researcher', 'debate-signal', 'debate-noise']);
  for (const p of ALL_PERSONAS) {
    expect(PERSONA_TOOLS[p].webfetch).toBe(webfetchAllowed.has(p));
  }
});
