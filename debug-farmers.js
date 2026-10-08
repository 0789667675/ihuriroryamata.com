const fs = require('fs');
const path = require('path');
const envPath = path.join(process.cwd(), '.env.local');
const envText = fs.readFileSync(envPath, 'utf8');
for (const line of envText.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq).trim();
  const value = trimmed.slice(eq + 1).trim();
  process.env[key] = value;
}

const { createSessionToken } = require('./lib/security/session.js');

(async () => {
  const token = createSessionToken({ id: 1, role: 'collector' });
  const response = await fetch('http://localhost:3003/api/farmers?limit=10', {
    headers: {
      cookie: `milk_session=${token}`,
    },
  });
  const text = await response.text();
  console.log('STATUS', response.status);
  console.log('BODY', text.slice(0, 2000));
})();
