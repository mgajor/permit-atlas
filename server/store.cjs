'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const initSqlJs = require('sql.js');
const { samples, SOURCES } = require('./sources.cjs');
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
function weekStart(now = new Date()) {
  const monday = new Date(now); monday.setUTCHours(0, 0, 0, 0); monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  return monday.toISOString().slice(0, 10);
}
async function openStore(dataDir, rootDir) {
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = path.join(dataDir, 'permit-atlas.sqlite');
  const SQL = await initSqlJs();
  let db = fs.existsSync(file) ? new SQL.Database(fs.readFileSync(file)) : new SQL.Database();
  const all = (sql, params = []) => {
    const statement = db.prepare(sql);
    try { statement.bind(params); const rows = []; while (statement.step()) rows.push(statement.getAsObject()); return rows; }
    finally { statement.free(); }
  };
  const get = (table, id) => { const row = all(`SELECT data FROM ${table} WHERE id=?`, [id])[0]; return row ? JSON.parse(row.data) : null; };
  const list = table => all(`SELECT data FROM ${table} ORDER BY rowid DESC`).map(row => JSON.parse(row.data));
  function persist() {
    const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      const fd = fs.openSync(temp, 'wx', 0o600);
      try { fs.writeFileSync(fd, Buffer.from(db.export())); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(temp, file);
    } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  }
  function transaction(fn) {
    const before = db.export();
    db.run('BEGIN IMMEDIATE');
    try { const result = fn(); db.run('COMMIT'); persist(); return result; }
    catch (error) {
      try { db.run('ROLLBACK'); } catch {}
      db.close(); db = new SQL.Database(before); throw error;
    }
  }
  db.run(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS permits (id TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS allocations (id TEXT PRIMARY KEY,permitId TEXT UNIQUE NOT NULL,customerId TEXT NOT NULL,weekStart TEXT NOT NULL,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reservations (projectKey TEXT PRIMARY KEY,permitId TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS allocation_week ON allocations(customerId,weekStart);`);
  const put = (table, value) => db.run(`INSERT INTO ${table}(id,data) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`, [value.id, JSON.stringify(value)]);
  function upsert(records) {
    let inserted = 0, updated = 0;
    for (const incoming of records) {
      const existing = get('permits', incoming.id);
      let permit = incoming;
      if (existing) {
        permit = { ...incoming, importedAt: existing.importedAt, reviewStatus: existing.reviewStatus, reviewNote: existing.reviewNote };
        if (existing.historical && !incoming.historical) {
          permit.raw = { ...incoming.raw, _historicalSample: existing.raw };
        } else if (existing.raw._historicalSample) permit.raw = { ...incoming.raw, _historicalSample: existing.raw._historicalSample };
        if (incoming.source === 'mesa' && existing.owner && !incoming.owner) {
          permit.owner = existing.owner; permit.mailingAddress = existing.mailingAddress;
          permit.evidence.push('Owner and mailing address retained from historical assessor enrichment: UNVERIFIED CANDIDATE MATCH; not current verified ownership.');
        }
        const changed = ['address', 'description', 'contractor', 'owner', 'mailingAddress', 'valuation', 'issuedDate', 'trade', 'synthetic'].some(key => existing[key] !== permit[key]);
        if (changed) { permit.reviewStatus = 'pending'; permit.reviewNote = 'Source information changed; review required again.'; }
        updated++;
      } else inserted++;
      if (all('SELECT id FROM allocations WHERE permitId=?', [permit.id]).length && permit.projectKey) {
        const reservation = all('SELECT permitId FROM reservations WHERE projectKey=?', [permit.projectKey])[0];
        if (reservation && reservation.permitId !== permit.id) throw fail('Refresh conflicts with an existing project reservation; no permit data changed.', 409);
        db.run('INSERT OR IGNORE INTO reservations(projectKey,permitId) VALUES (?,?)', [permit.projectKey, permit.id]);
      }
      put('permits', permit);
    }
    return { inserted, updated };
  }
  if (!all("SELECT value FROM meta WHERE key='samplesImported'").length) {
    const records = list('permits').length ? [] : samples();
    transaction(() => { upsert(records); db.run("INSERT INTO meta(key,value) VALUES ('samplesImported',?)", [new Date().toISOString()]); });
  }
  if (list('runs').some(run => run.status === 'running')) transaction(() => {
    for (const run of list('runs')) if (run.status === 'running') put('runs', { ...run, status: 'failed', error: 'Refresh interrupted by previous shutdown. No partial permit import was committed.' });
  });
  return {
    state() {
      const permits = list('permits');
      const sources = SOURCES.map(({ id, name, url, description }) => {
        const rows = permits.filter(p => p.source === id);
        return { id, name, url, description, latestIssuedDate: rows.reduce((latest, p) => p.issuedDate > latest ? p.issuedDate : latest, '') || null, count: rows.length, synthetic: rows.some(p => p.synthetic === true) };
      });
      return { permits, customers: list('customers'), allocations: list('allocations'), runs: list('runs'), sources, synthetic: permits.some(p => p.synthetic === true) };
    },
    runStart(source) {
      const run = { id: crypto.randomUUID(), source, startedAt: new Date().toISOString(), status: 'running', inserted: 0, updated: 0, error: null };
      transaction(() => put('runs', run)); return run;
    },
    runFinish(run, records, error) {
      if (error) { const failed = { ...run, status: 'failed', error: String(error.message || error) }; transaction(() => put('runs', failed)); return failed; }
      return transaction(() => { const counts = upsert(records); const finished = { ...run, ...counts, status: 'success' }; put('runs', finished); return finished; });
    },
    review(ids, status, note) {
      transaction(() => {
        for (const id of ids) { const permit = get('permits', id); if (!permit) throw fail(`Permit not found: ${id}`, 404); put('permits', { ...permit, reviewStatus: status, reviewNote: note }); }
      });
    },
    customer(value) {
      const customer = { id: crypto.randomUUID(), ...value };
      transaction(() => put('customers', customer)); return customer;
    },
    allocate(customerId, ids) {
      transaction(() => {
        const customer = get('customers', customerId);
        if (!customer) throw fail('Customer not found', 404);
        const week = weekStart();
        const count = all('SELECT count(*) AS n FROM allocations WHERE customerId=? AND weekStart=?', [customerId, week])[0].n;
        if (count + ids.length > customer.weeklyCap) throw fail(`Weekly cap exceeded: ${count} already allocated of ${customer.weeklyCap} (UTC Monday week).`, 409);
        for (const id of ids) {
          const permit = get('permits', id);
          if (!permit) throw fail(`Permit not found: ${id}`, 404);
          if (!permit.address || !permit.permitId || !permit.projectKey) throw fail('Allocation requires a source permit ID and address', 409);
          if (permit.reviewStatus !== 'approved') throw fail('Every selected permit must be explicitly approved before allocation', 409);
          if (customer.source !== 'all' && permit.source !== customer.source) throw fail('Permit does not match customer source', 409);
          if (customer.trade !== 'all' && permit.trade !== customer.trade) throw fail('Permit does not match customer trade', 409);
          if (all('SELECT id FROM allocations WHERE permitId=?', [id]).length || all('SELECT permitId FROM reservations WHERE projectKey=?', [permit.projectKey]).length) throw fail(`Project already exclusively reserved: ${permit.address}`, 409);
          const allocation = { id: crypto.randomUUID(), permitId: id, customerId, allocatedAt: new Date().toISOString(), weekStart: week };
          db.run('INSERT INTO allocations(id,permitId,customerId,weekStart,data) VALUES (?,?,?,?,?)', [allocation.id, id, customerId, week, JSON.stringify(allocation)]);
          db.run('INSERT INTO reservations(projectKey,permitId) VALUES (?,?)', [permit.projectKey, id]);
        }
      });
    },
    close() { db.close(); },
  };
}
module.exports = { openStore, fail };
