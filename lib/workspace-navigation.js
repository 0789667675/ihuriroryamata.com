const TAB_PATTERN = /^[a-z][a-z0-9-]*$/;

function resolveWorkspaceTab(requestedTab, allowedTabs) {
  const fallbackTab = allowedTabs[0] || 'dashboard';
  if (typeof requestedTab !== 'string') return fallbackTab;
  const normalizedTab = requestedTab.trim().toLowerCase();
  return TAB_PATTERN.test(normalizedTab) && allowedTabs.includes(normalizedTab)
    ? normalizedTab
    : fallbackTab;
}

module.exports = { resolveWorkspaceTab };