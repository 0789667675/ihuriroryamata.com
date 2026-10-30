const TAB_PATTERN = /^[a-z][a-z0-9-]*$/;

const COLLECTOR_TABS = ['dashboard', 'farmers', 'milk', 'deductions', 'reports', 'ukwezi', 'settlements', 'settings'];
const DAIRY_TABS = ['dashboard', 'centers', 'milk', 'ukwezi', 'settlements', 'reports', 'billing', 'notifications', 'settings'];
const ADMIN_TABS = ['dashboard', 'accounts', 'audit', 'config', 'settings', 'system-health', 'notifications-admin'];

function resolveWorkspaceTab(requestedTab, allowedTabs) {
  const fallbackTab = allowedTabs[0] || 'dashboard';
  if (typeof requestedTab !== 'string') return fallbackTab;
  const normalizedTab = requestedTab.trim().toLowerCase();
  return TAB_PATTERN.test(normalizedTab) && allowedTabs.includes(normalizedTab)
    ? normalizedTab
    : fallbackTab;
}

module.exports = {
  resolveWorkspaceTab,
  COLLECTOR_TABS,
  DAIRY_TABS,
  ADMIN_TABS,
};
