const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const workspace = fs.readFileSync(path.join(root, 'app', 'workspace.tsx'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'app', 'globals.css'), 'utf8');
const publicCopy = fs.readFileSync(path.join(root, 'lib', 'i18n', 'public-copy.ts'), 'utf8');

test('Ifishi search results are the selectable farmer options and there is no second selector', () => {
  const ifishi = workspace.slice(workspace.indexOf('const renderIfishi ='), workspace.indexOf('const renderDashboard'));
  assert.match(ifishi, /role="combobox"/);
  assert.match(ifishi, /aria-controls="ifishi-farmer-results"/);
  assert.match(ifishi, /role="listbox"/);
  assert.match(ifishi, /role="option"/);
  assert.match(ifishi, /aria-selected=\{String\(farmer\.id\) === ifishiFarmerId\}/);
  assert.match(ifishi, /onClick=\{\(\) => chooseIfishiFarmer\(farmer, index\)\}/);
  assert.match(ifishi, /setIfishiFarmerSearch\(farmer\.name\)/);
  assert.match(ifishi, /setIfishiFarmerId\(''\)/);
  assert.match(ifishi, /ifishiSelectedFarmer/);
  assert.doesNotMatch(ifishi, /<select required value=\{ifishiFarmerId\}/);
  assert.doesNotMatch(ifishi, /accountCopy\('deductionsFarmer', 'milkAbacunda'\).*<select/);
});

test('Ifishi search is responsive, keyboard accessible, and keeps the existing account scope', () => {
  const loader = workspace.slice(workspace.indexOf('const loadIfishiFarmers'), workspace.indexOf('const loadIfishiRecords'));
  const ifishi = workspace.slice(workspace.indexOf('const renderIfishi ='), workspace.indexOf('const renderDashboard'));

  assert.match(workspace, /setDebouncedIfishiFarmerSearch\(ifishiFarmerSearch\.trim\(\)\), 200\)/);
  assert.match(loader, /user\?\.accountType === 'COLLECTOR'.*collectorUserId/);
  assert.match(loader, /selectedCenter[\s\S]*centerName/);
  assert.match(loader, /params\.set\('center', centerName\)/);
  assert.doesNotMatch(loader, /setIfishiFarmerId\(String\(result\.data\[0\]\.id\)\)/);
  assert.match(loader, /ifishiFarmerRequestRef/);
  assert.match(ifishi, /event\.key === 'ArrowDown'/);
  assert.match(ifishi, /event\.key === 'ArrowUp'/);
  assert.match(ifishi, /event\.key === 'Enter'/);
});

test('Ifishi search results have contained desktop and mobile presentation', () => {
  assert.match(styles, /\.ifishi-search-results \{[^}]*max-height: 230px;[^}]*overflow-y: auto;/);
  assert.match(styles, /\.ifishi-search-result\[aria-selected="true"\]/);
  assert.match(styles, /\.ifishi-selected-person/);
  assert.equal((publicCopy.match(/\bifishiSearchResults:/g) || []).length, 2);
  assert.equal((publicCopy.match(/\bifishiSelectedFarmer:/g) || []).length, 2);
});
