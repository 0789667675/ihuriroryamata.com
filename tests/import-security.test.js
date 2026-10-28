const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const OCR = require('../lib/services/ocr-service.js');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const OCR_ENV_KEYS = [
  'GOOGLE_VISION_API_KEY',
  'GOOGLE_VISION_SERVICE_ACCOUNT_JSON',
  'GOOGLE_VISION_SERVICE_ACCOUNT_BASE64',
  'GOOGLE_APPLICATION_CREDENTIALS',
];

const withCleanOcrEnv = (t) => {
  const saved = Object.fromEntries(OCR_ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of OCR_ENV_KEYS) delete process.env[key];
  t.after(() => {
    for (const key of OCR_ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });
};

test('OCR reports an honest unconfigured state and refuses to fake a scan', async (t) => {
  withCleanOcrEnv(t);
  const configuration = OCR.getOcrConfiguration();
  assert.equal(configuration.configured, false);
  assert.equal(configuration.provider, 'google-cloud-vision');
  assert.ok(configuration.setup.includes('GOOGLE_VISION_API_KEY'));

  await assert.rejects(
    () => OCR.extractTextFromImage({ base64: '/9j/4AAQSkZJRg==' }),
    (error) => error.code === 'OCR_NOT_CONFIGURED' && error.statusCode === 503
      && Array.isArray(error.setup)
      && !JSON.stringify(error).includes('GOOGLE_VISION_SERVICE_ACCOUNT_JSON=')
  );
});

test('OCR validates image bytes before calling the provider', async (t) => {
  withCleanOcrEnv(t);
  process.env.GOOGLE_VISION_API_KEY = 'server-only-test-key';
  const configuration = OCR.getOcrConfiguration();
  assert.equal(configuration.configured, true);
  assert.equal(configuration.auth, 'api-key');
  assert.equal(configuration.provider, 'google-cloud-vision');

  await assert.rejects(
    () => OCR.extractTextFromImage({ base64: 'not-an-image' }),
    (error) => error.code === 'OCR_IMAGE_INVALID' && error.statusCode === 400
  );
  await assert.rejects(
    () => OCR.extractTextFromImage({ base64: '/9j/' + 'a'.repeat(10_000_001) }),
    (error) => error.code === 'OCR_IMAGE_INVALID' && error.statusCode === 400
  );
});

test('OCR forwards only the image to Google Vision and returns geometry for review', async (t) => {
  withCleanOcrEnv(t);
  process.env.GOOGLE_VISION_API_KEY = 'server-only-test-key';
  const originalFetch = global.fetch;
  let request;
  global.fetch = async (url, init) => {
    request = { url, init };
    return new Response(JSON.stringify({
      responses: [{
        fullTextAnnotation: {
          text: 'Izina 2026-10-25\nMUKAMANA Alice 12',
          pages: [{
            blocks: [{
              paragraphs: [{
                words: [{
                  symbols: [{ text: 'MUKAMANA' }, { text: 'Alice' }],
                  confidence: 0.97,
                  boundingBox: {
                    vertices: [
                      { x: 10, y: 20 }, { x: 90, y: 20 }, { x: 90, y: 36 }, { x: 10, y: 36 },
                    ],
                  },
                }],
              }],
            }],
          }],
        },
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  t.after(() => { global.fetch = originalFetch; });

  const result = await OCR.extractTextFromImage({ base64: '/9j/4AAQSkZJRg==' });
  assert.equal(result.provider, 'google-cloud-vision');
  assert.match(result.text, /MUKAMANA/);
  assert.deepEqual(result.words, [{
    text: 'MUKAMANAAlice',
    x: 10,
    y: 20,
    width: 80,
    height: 16,
    confidence: 0.97,
  }]);

  assert.equal(request.url, 'https://vision.googleapis.com/v1/images:annotate');
  assert.equal(request.init.method, 'POST');
  assert.equal(request.init.headers['X-Goog-Api-Key'], 'server-only-test-key');
  assert.equal(request.init.headers.Authorization, undefined);
  const payload = JSON.parse(request.init.body);
  assert.equal(payload.requests[0].features[0].type, 'DOCUMENT_TEXT_DETECTION');
  assert.equal(payload.requests[0].image.content, '/9j/4AAQSkZJRg==');
  assert.match(request.init.body, /DOCUMENT_TEXT_DETECTION/);
  assert.doesNotMatch(request.init.body, /server-only-test-key/);
  assert.doesNotMatch(JSON.stringify(result), /server-only-test-key/);
});

test('service-account credentials are accepted without exposing them to callers', (t) => {
  withCleanOcrEnv(t);
  process.env.GOOGLE_VISION_SERVICE_ACCOUNT_JSON = JSON.stringify({
    client_email: 'vision@example.iam.gserviceaccount.com',
    private_key: 'not-used-for-configuration-check',
  });
  const configuration = OCR.getOcrConfiguration();
  assert.equal(configuration.configured, true);
  assert.equal(configuration.auth, 'service-account');
  assert.equal(JSON.stringify(configuration).includes('private_key'), false);
  assert.equal(JSON.stringify(configuration).includes('example.iam'), false);
});

test('import endpoints require authentication, account type, subscription, and server identity', () => {
  const farmers = read('app/api/farmers/import/route.js');
  assert.match(farmers, /getAuthenticatedUser\(request\)/);
  assert.match(farmers, /requireAccountType\(user, \['COLLECTOR', 'COLLECTION_CENTER'\]\)/);
  assert.match(farmers, /await requireActiveSubscription\(user\)/);
  assert.match(farmers, /ownerUserId: user\.id/);
  assert.match(farmers, /actorId: user\.id/);
  assert.match(farmers, /batchKey: body\.batchKey/);
  assert.match(farmers, /dryRun: body\.dryRun === true/);
  assert.doesNotMatch(farmers, /body\.ownerUserId|body\.actorId/);

  const milk = read('app/api/milk/import/route.js');
  assert.match(milk, /getAuthenticatedUser\(request\)/);
  assert.match(milk, /requireAccountType\(user, \['COLLECTOR'\]\)/);
  assert.match(milk, /await requireActiveSubscription\(user\)/);
  assert.match(milk, /ownerUserId: user\.id/);
  assert.match(milk, /actorId: user\.id/);
  assert.match(milk, /collectorUserId: user\.id/);
  assert.match(milk, /date: body\.date/);
  assert.doesNotMatch(milk, /body\.ownerUserId|body\.collectorUserId/);

  const ocr = read('app/api/imports/ocr/route.js');
  assert.match(ocr, /getAuthenticatedUser\(request\)/);
  assert.match(ocr, /requireAccountType\(user, \['COLLECTOR', 'COLLECTION_CENTER'\]\)/);
  assert.match(ocr, /await requireActiveSubscription\(user\)/);
  assert.match(ocr, /extractTextFromImage\(\{ base64: body\.imageBase64 \}\)/);
  assert.doesNotMatch(ocr, /GOOGLE_VISION_API_KEY|GOOGLE_VISION_SERVICE_ACCOUNT/);

  const extract = read('app/api/imports/extract/route.js');
  assert.match(extract, /getAuthenticatedUser\(request\)/);
  assert.match(extract, /requireAccountType\(user, \['COLLECTOR', 'COLLECTION_CENTER'\]\)/);
  assert.match(extract, /await requireActiveSubscription\(user\)/);
  assert.match(extract, /Buffer\.from\(await file\.arrayBuffer\(\)\)/);
  assert.doesNotMatch(extract, /writeFile|createWriteStream|tmpdir/);
});

test('workspace exposes both imports only to eligible roles and refreshes saved data', () => {
  const workspace = read('app/workspace.tsx');
  assert.match(workspace, /setFarmerImportOpen\(true\)/);
  assert.match(workspace, /setMilkImportOpen\(true\)/);
  assert.match(workspace, /<FarmerBulkImportModal/);
  assert.match(workspace, /onCompleted=\{async \(\) => \{ await loadFarmers\(\); \}\}/);
  assert.match(workspace, /<MilkNotebookImportModal/);
  assert.match(workspace, /onCompleted=\{async \(\) => \{ await loadDaily\(\); \}\}/);
  assert.match(workspace, /milkImportOpen && user && isCollector/);
  assert.match(workspace, /farmerImportOpen && user && !isAdmin && \(isCollector \|\| isDairy\)/);
});

test('import UI and parsing code keeps source documents out of browser persistence and logs', () => {
  const files = [
    'components/imports/farmer-bulk-import.tsx',
    'components/imports/milk-notebook-import.tsx',
    'components/imports/import-ui.tsx',
    'lib/imports/client-api.ts',
    'lib/imports/client-files.ts',
    'lib/imports/farmer-matching.js',
    'lib/imports/notebook.js',
    'lib/imports/text-parsing.js',
  ];
  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|console\.(log|debug|info)/, `${file} must not persist or log import source data`);
  }
  const milk = read('components/imports/milk-notebook-import.tsx');
  assert.match(milk, /URL\.revokeObjectURL\(previewRef\.current\)/);
  assert.match(milk, /\.\.\.draft/);
  assert.doesNotMatch(milk, /fetch\('\/api\/imports\/extract'/);
});

test('import batch migration is server-only, stores only outcomes, and is required by health', () => {
  const migration = read('supabase/migrations/019_import_batches.sql');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.import_batches/);
  assert.match(migration, /UNIQUE \(owner_user_id, batch_key\)/);
  assert.match(migration, /summary JSONB NOT NULL DEFAULT '\{\}'::jsonb/);
  assert.match(migration, /ALTER TABLE public\.import_batches ENABLE ROW LEVEL SECURITY/);
  assert.match(
    migration,
    /CREATE POLICY milk_system_deny_data_api_access[\s\S]*?TO anon, authenticated[\s\S]*?USING \(false\)[\s\S]*?WITH CHECK \(false\)/
  );
  assert.doesNotMatch(migration, /GRANT[\s\S]*?TO authenticated/);
  assert.match(migration, /GRANT ALL\s+ON public\.import_batches\s+TO service_role/s);
  const tableDefinition = migration.slice(migration.indexOf('CREATE TABLE'), migration.indexOf(');', migration.indexOf('CREATE TABLE')) + 2);
  assert.doesNotMatch(tableDefinition, /\b(name|phone|national_id|account_number|document|image|ocr_text)\b/i);

  const health = read('app/api/health/route.ts');
  assert.match(health, /'019'/);
  const docs = read('docs/imports-setup.md');
  assert.match(docs, /GOOGLE_VISION_API_KEY/);
  assert.match(docs, /GOOGLE_APPLICATION_CREDENTIALS/);
  const env = read('.env.example');
  assert.match(env, /GOOGLE_VISION_API_KEY=/);
  assert.doesNotMatch(env, /NEXT_PUBLIC_GOOGLE_VISION/);
});
