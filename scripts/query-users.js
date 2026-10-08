const fs = require('fs');
const { Client } = require('pg');

const certText = fs.readFileSync('lib/supabase-root-ca-2021.js', 'utf8');
const certMatch = certText.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/);
if (!certMatch) {
  throw new Error('Missing Supabase CA certificate');
}
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true, ca: certMatch[0] },
});

(async () => {
  await client.connect();
  const res = await client.query("SELECT id, email, role, account_type, password_hash, email_verified FROM users WHERE email ILIKE '%collector%' OR email ILIKE '%admin%' ORDER BY id LIMIT 20");
  console.log(JSON.stringify(res.rows, null, 2));
  await client.end();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
