const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('project has the required architecture foundation for the next migration phase', () => {
  const root = path.join(__dirname, '..');
  const requiredPaths = [
    'app/page.tsx',
    'app/(auth)/login/page.tsx',
    'app/(dashboard)/layout.tsx',
    'components/ui/button.tsx',
    'components/ui/input.tsx',
    'components/ui/card.tsx',
    'lib/config/site.ts',
    'lib/validation/auth.ts',
    'server/domain/auth.ts',
    'server/repositories/user-repository.ts',
    'server/services/auth-service.ts',
  ];

  for (const filePath of requiredPaths) {
    assert.ok(fs.existsSync(path.join(root, filePath)), `Missing foundation file: ${filePath}`);
  }
});
