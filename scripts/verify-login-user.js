const { Client } = require('pg');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const ca = fs.readFileSync('lib/supabase-root-ca-2021.js', 'utf8').match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/)[0];
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: true, ca },
});

(async () => {
  await client.connect();
  const email = 'qa.collector.user@example.com';
  const passwordHash = await bcrypt.hash('Password123!', 10);
  await client.query(
    `INSERT INTO users (name, email, password_hash, role, account_type, account_status, email_verified, email_verified_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, TRUE, NOW(), NOW(), NOW())
     ON CONFLICT (email) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       email_verified = TRUE,
       email_verified_at = NOW(),
       account_type = EXCLUDED.account_type,
       updated_at = NOW()`,
    ['QA Collector', email, passwordHash, 'user', 'COLLECTOR', 'active']
  );
  const result = await client.query("SELECT id, email, role, account_type, email_verified, password_hash FROM users WHERE email = $1", [email]);
  console.log(JSON.stringify(result.rows, null, 2));
  if (result.rows[0]) {
    console.log('matchesPassword123=', bcrypt.compareSync('Password123!', result.rows[0].password_hash));
  }
  await client.end();
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
