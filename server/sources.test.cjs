'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { samples, fetchRecords } = require('./sources.cjs');
const { openStore } = require('./store.cjs');

test('fresh workspaces load only synthetic fixtures, never legacy files from the supplied root', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'permit-atlas-safe-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Invalid legacy contents would throw if the former automatic importer read them.
  for (const filename of ['feed_chicago_2026-10-02.csv', 'feed_seattle_2026-10-02.csv', 'mesa_leads_enriched_2026-10-03.csv', 'phoenix_week_2026-09-26_10-02.json']) fs.writeFileSync(path.join(root, filename), 'NOT VALID INPUT "');
  const store = await openStore(path.join(root, 'workspace'), root);
  t.after(() => store.close());
  const state = store.state();
  assert.equal(state.synthetic, true);
  assert.deepEqual(new Set(state.permits.map(p => p.source)), new Set(['chicago', 'seattle', 'mesa']));
  for (const permit of state.permits) {
    assert.equal(permit.synthetic, true);
    assert.equal(permit.raw.synthetic, true);
    assert.equal(permit.reviewStatus, 'pending');
    assert.match(permit.id, /^(chicago|seattle|mesa):DEMO-/);
    assert.ok(permit.address === '' || permit.address.includes('NOT DELIVERABLE'));
    assert.match(permit.evidence[0], /SYNTHETIC/);
  }
});

test('ambiguous candidates and missing contractors remain unknown, never open', () => {
  const permits = samples();
  const candidate = permits.find(p => p.id === 'mesa:DEMO-MES-004');
  assert.equal(candidate.contractorStatus, 'unknown');
  assert.equal(candidate.reviewStatus, 'pending');
  assert.ok(candidate.evidence.some(line => /UNVERIFIED CANDIDATE MATCH/.test(line)));
  assert.equal(candidate.valuation, null);
  assert.equal(permits.find(p => p.id === 'chicago:DEMO-CHI-003').contractorStatus, 'named');
  assert.equal(permits.find(p => p.id === 'chicago:DEMO-CHI-005').projectKey, '');
  const first = permits.find(p => p.id === 'chicago:DEMO-CHI-001');
  const second = permits.find(p => p.id === 'chicago:DEMO-CHI-002');
  assert.notEqual(first.id, second.id);
  assert.equal(first.projectKey, second.projectKey);
});

test('live keyword classification prioritizes specific rooftop HVAC, solar and pool work', async t => {
  const rows = [
    { permitnum: 'LIVE-HVAC', description: 'Replace roof mounted HVAC equipment', originaladdress1: 'Example test address' },
    { permitnum: 'LIVE-SOLAR', description: 'Solar roof panels and electrical work' },
    { permitnum: 'LIVE-POOL', description: 'Pool installation with electrical and plumbing' },
    { permitnum: 'LIVE-ROOF', description: 'Replace roof shingles' },
  ];
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, text: async () => JSON.stringify(rows) }));
  const permits = await fetchRecords('seattle', 7);
  assert.deepEqual(permits.map(p => p.trade), ['hvac/mech', 'solar', 'pool/spa', 'roofing']);
  for (const permit of permits) {
    assert.equal(permit.synthetic, false);
    assert.equal(permit.contractorStatus, 'unknown');
    assert.equal(permit.reviewStatus, 'pending');
  }
});

test('existing workspace records are not replaced or augmented when the sample marker is absent', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'permit-atlas-existing-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const SQL = await require('sql.js')();
  const db = new SQL.Database();
  const existing = { id: 'mesa:existing-private-record', source: 'mesa', address: 'Existing locally owned record', reviewStatus: 'approved', raw: { locallyOwned: true } };
  db.run('CREATE TABLE permits (id TEXT PRIMARY KEY,data TEXT NOT NULL)');
  db.run('INSERT INTO permits(id,data) VALUES (?,?)', [existing.id, JSON.stringify(existing)]);
  fs.writeFileSync(path.join(root, 'permit-atlas.sqlite'), db.export());
  db.close();
  const store = await openStore(root, root);
  t.after(() => store.close());
  assert.deepEqual(store.state().permits, [existing]);
});

test('material changes invalidate prior review without changing the original import timestamp', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'permit-atlas-review-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = await openStore(root, root);
  t.after(() => store.close());
  const original = store.state().permits.find(p => p.id === 'chicago:DEMO-CHI-001');
  store.review([original.id], 'approved', 'Reviewed original scope');
  store.runFinish(store.runStart('chicago'), [{ ...original, description: 'Changed fictional work scope', importedAt: '2099-01-01T00:00:00.000Z' }]);
  const changed = store.state().permits.find(p => p.id === original.id);
  assert.equal(changed.reviewStatus, 'pending');
  assert.equal(changed.importedAt, original.importedAt);
  assert.equal(changed.description, 'Changed fictional work scope');
});
