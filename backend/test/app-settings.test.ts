import { test, expect, beforeEach } from 'bun:test';
import { initDb, getDb } from '../src/db.js';
import { appSettings } from '../src/app-settings.js';

beforeEach(() => {
  // Use an in-memory DB per test to avoid cross-test pollution.
  initDb(':memory:');
  getDb().exec('DELETE FROM app_settings');
});

test('get returns null when key is absent', () => {
  expect(appSettings.get('useOpencode')).toBeNull();
});

test('set then get returns the stored string value', () => {
  appSettings.set('useOpencode', 'true');
  expect(appSettings.get('useOpencode')).toBe('true');
});

test('set overwrites an existing value', () => {
  appSettings.set('useOpencode', 'true');
  appSettings.set('useOpencode', 'false');
  expect(appSettings.get('useOpencode')).toBe('false');
});

test('getBool parses true/false and falls back to default', () => {
  expect(appSettings.getBool('useOpencode', false)).toBe(false);
  appSettings.set('useOpencode', 'true');
  expect(appSettings.getBool('useOpencode', false)).toBe(true);
  appSettings.set('useOpencode', 'false');
  expect(appSettings.getBool('useOpencode', true)).toBe(false);
});
