const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveWorkspaceTab,
  COLLECTOR_TABS,
  DAIRY_TABS,
  ADMIN_TABS,
} = require('../lib/workspace-navigation');

const collectorTabs = COLLECTOR_TABS || ['dashboard', 'farmers', 'milk', 'deductions', 'reports', 'ukwezi', 'settlements', 'settings'];
const dairyTabs = DAIRY_TABS || ['dashboard', 'centers', 'milk', 'ukwezi', 'settlements', 'reports', 'billing', 'notifications', 'settings'];
const adminTabs = ADMIN_TABS || ['dashboard', 'accounts', 'audit', 'config', 'settings', 'system-health', 'notifications-admin'];

test('workspace URL tabs resolve direct navigation case-insensitively to supported tabs', () => {
  assert.equal(resolveWorkspaceTab('ukwezi', collectorTabs), 'ukwezi');
  assert.equal(resolveWorkspaceTab('SETTLEMENTS', collectorTabs), 'settlements');
  assert.equal(resolveWorkspaceTab('system-health', adminTabs), 'system-health');
  assert.equal(resolveWorkspaceTab('centers', dairyTabs), 'centers');
  assert.equal(resolveWorkspaceTab('settlements', dairyTabs), 'settlements');
});

test('Collection Center mirror tabs exclude flat farmers tab and resolve collectors as primary directory', () => {
  assert.equal(resolveWorkspaceTab('farmers', dairyTabs), 'dashboard');
  assert.equal(resolveWorkspaceTab('centers', dairyTabs), 'centers');
  assert.equal(resolveWorkspaceTab('milk', dairyTabs), 'milk');
  assert.equal(resolveWorkspaceTab('settlements', dairyTabs), 'settlements');
});

test('unknown, malformed, empty, and role-restricted workspace tabs fall back safely', () => {
  for (const requestedTab of ['unknown', 'accounts', '../settings', '', null, undefined]) {
    assert.equal(resolveWorkspaceTab(requestedTab, collectorTabs), 'dashboard');
  }
  assert.equal(resolveWorkspaceTab('farmers', adminTabs), 'dashboard');
  assert.equal(resolveWorkspaceTab('farmers', dairyTabs), 'dashboard');
});

test('workspace tab URL updates preserve required query parameters and never store modal state', () => {
  const url = new URL('https://milk.example.test/workspace?lang=rw&center=5&payment=resume');
  url.searchParams.set('tab', resolveWorkspaceTab('settlements', collectorTabs));
  assert.equal(url.search, '?lang=rw&center=5&payment=resume&tab=settlements');

  url.searchParams.set('tab', 'milk');
  assert.equal(url.searchParams.has('ownerIfishiOpen'), false);
  assert.equal(url.searchParams.has('correctionModal'), false);
});
