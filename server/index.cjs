'use strict';
const express = require('express');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { openStore, fail } = require('./store.cjs');
const { fetchRecords, SOURCES } = require('./sources.cjs');
const { openMail } = require('./mail.cjs');
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function csvCell(value) {
  let s = value == null ? '' : String(value);
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(s) || /^[\t\r\n]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
function requireText(value, label, max = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw fail(`${label} must be a non-empty string of at most ${max} characters`);
  return value.trim();
}
function idsInput(ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || ids.some(id => typeof id !== 'string' || !id || id.length > 250)) throw fail('Select between 1 and 1000 valid permit IDs');
  if (new Set(ids).size !== ids.length) throw fail('Duplicate permit IDs are not allowed');
  return ids;
}
async function startWorkspaceServer({ port = 0, host = '127.0.0.1', dataDir = path.join(os.homedir(), '.permit-atlas'), rootDir = path.resolve(__dirname, '..'), staticDir, credentialStore, mailTransport, mailTimeoutMs } = {}) {
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('Server may only bind to a loopback host');
  const store = await openStore(path.resolve(dataDir), path.resolve(rootDir));
  let mail;
  try { mail = await openMail({ dataDir: path.resolve(dataDir), store, credentialStore, transport: mailTransport, timeoutMs: mailTimeoutMs }); }
  catch (error) { store.close(); throw error; }
  const app = express(); app.disable('x-powered-by');
  const refreshing = new Set(); const active = new Set();
  let closing = false;
  const localHost = name => ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(name);
  app.use((req, res, next) => {
    let requested;
    try { requested = new URL(`http://${req.headers.host}`); } catch { return res.status(403).json({ error: 'Local host required' }); }
    if (!localHost(requested.hostname)) return res.status(403).json({ error: 'Local host required' });
    const origin = req.headers.origin;
    if (origin) {
      let parsed;
      try { parsed = new URL(origin); } catch { return res.status(403).json({ error: 'Local origin required' }); }
      const sameOrigin = parsed.protocol === 'http:' && parsed.host === requested.host;
      const development = process.env.NODE_ENV !== 'production' && parsed.protocol === 'http:' && localHost(parsed.hostname) && ['5173', '4173'].includes(parsed.port);
      if (!sameOrigin && !development) return res.status(403).json({ error: 'Origin not allowed' });
      res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    } else if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Cross-site requests are not allowed' });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.post('/api/mail/batches', express.json({ limit: '16mb', strict: true }));
  app.use('/api', express.json({ limit: '256kb', strict: true }));
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (closing) return res.status(503).json({ error: 'Server is shutting down' });
    if (req.method === 'POST' && !req.is('application/json')) return res.status(415).json({ error: 'Content-Type must be application/json' });
    next();
  });
  const mailRoute = handler => (req, res, next) => {
    const operation = Promise.resolve().then(() => handler(req, res));
    active.add(operation);
    operation.then(() => active.delete(operation), error => { active.delete(operation); next(error); });
  };
  app.get('/api/mail/status', (req, res) => res.json(mail.status()));
  app.post('/api/mail/key', mailRoute(async (req, res) => res.json(await mail.setKey(req.body))));
  app.delete('/api/mail/key', mailRoute(async (req, res) => res.json(await mail.deleteKey())));
  app.post('/api/mail/batches', mailRoute((req, res) => res.status(201).json(mail.create(req.body))));
  app.post('/api/mail/batches/:id/submit', mailRoute(async (req, res) => {
    const batch = await mail.submit(req.params.id, req.body);
    res.status(batch.status === 'uncertain' ? 502 : batch.status === 'failed' ? 502 : 200).json(batch);
  }));
  app.get('/api/mail/batches/:id/provider', mailRoute(async (req, res) => res.json(await mail.refresh(req.params.id))));
  app.get('/api/mail/batches/:id/artwork/:side', (req, res) => {
    const art = mail.artwork(req.params.id, req.params.side);
    res.type(art.type).send(art.bytes);
  });
  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.get('/api/state', (req, res) => res.json(store.state()));
  app.post('/api/review', (req, res) => {
    const { ids, status, note = '' } = req.body || {};
    if (!['approved', 'rejected', 'pending'].includes(status)) throw fail('Invalid review status');
    if (typeof note !== 'string' || note.length > 4000) throw fail('Review note must be at most 4000 characters');
    store.review(idsInput(ids), status, note); res.json({ ok: true });
  });
  app.post('/api/customers', (req, res) => {
    const { name, source, trade, weeklyCap } = req.body || {};
    const customer = { name: requireText(name, 'Customer name'), source: requireText(source, 'Source'), trade: requireText(trade, 'Trade'), weeklyCap };
    if (source !== 'all' && !SOURCES.some(s => s.id === source)) throw fail('Unknown customer source');
    if (!Number.isSafeInteger(weeklyCap) || weeklyCap < 1 || weeklyCap > 10000) throw fail('Weekly cap must be an integer from 1 to 10000');
    res.status(201).json(store.customer(customer));
  });
  app.post('/api/allocate', (req, res) => {
    const { customerId, ids } = req.body || {};
    store.allocate(requireText(customerId, 'Customer ID'), idsInput(ids)); res.json({ ok: true });
  });
  app.post('/api/sync', (req, res, next) => {
    const { source, days } = req.body || {};
    if (!['chicago', 'seattle', 'mesa'].includes(source)) throw fail('Choose Chicago, Seattle or Mesa for live refresh');
    if (![7, 30, 90].includes(days)) throw fail('Refresh window must be 7, 30, or 90 days');
    if (refreshing.has(source)) throw fail('This source is already refreshing', 409);
    refreshing.add(source);
    let run;
    try { run = store.runStart(source); } catch (error) { refreshing.delete(source); throw error; }
    const operation = (async () => {
      try {
        const records = await fetchRecords(source, days);
        res.json(store.runFinish(run, records));
      } catch (error) {
        try { res.json(store.runFinish(run, null, error)); } catch (persistError) { next(persistError); }
      } finally { refreshing.delete(source); }
    })();
    active.add(operation); operation.finally(() => active.delete(operation));
  });
  app.get('/api/export', (req, res) => {
    const state = store.state(); let permits = state.permits;
    if (req.query.ids !== undefined) {
      if (typeof req.query.ids !== 'string') throw fail('Invalid export IDs');
      const ids = idsInput(req.query.ids.split(',')); const selected = new Set(ids);
      permits = permits.filter(p => selected.has(p.id));
      if (permits.length !== selected.size) throw fail('One or more export permits were not found', 404);
    }
    const fields = ['id', 'source', 'permitId', 'address', 'issuedDate', 'trade', 'zone', 'valuation', 'valuationType', 'owner', 'mailingAddress', 'contractorStatus', 'contractor', 'reviewStatus', 'reviewNote', 'historical', 'description', 'evidence', 'sourceUrl', 'allocatedCustomer', 'allocatedAt'];
    const rows = permits.map(p => {
      const allocation = state.allocations.find(a => a.permitId === p.id);
      return { ...p, evidence: p.evidence.join(' | '), sourceUrl: SOURCES.find(s => s.id === p.source)?.url, allocatedCustomer: allocation ? state.customers.find(c => c.id === allocation.customerId)?.name || allocation.customerId : '', allocatedAt: allocation?.allocatedAt || '' };
    });
    const csv = [fields.map(csvCell).join(','), ...rows.map(row => fields.map(key => csvCell(row[key])).join(','))].join('\r\n');
    res.setHeader('Content-Disposition', 'attachment; filename="permit-atlas.csv"'); res.type('text/csv').send('\ufeff' + csv);
  });
  app.get('/api/digest', (req, res) => {
    const id = requireText(req.query.customerId, 'Customer ID');
    const state = store.state(); const customer = state.customers.find(c => c.id === id);
    if (!customer) throw fail('Customer not found', 404);
    const allocations = state.allocations.filter(a => a.customerId === id);
    const cards = allocations.map(a => {
      const p = state.permits.find(p => p.id === a.permitId);
      if (!p) return '';
      const source = SOURCES.find(s => s.id === p.source);
      return `<article><div class="tag">${escapeHtml(source?.name)} · ${p.historical ? 'HISTORICAL SAMPLE — NOT A FRESH LEAD' : 'PUBLIC RECORD — AVAILABILITY UNVERIFIED'}</div><h2>${escapeHtml(p.address)}</h2><p>${escapeHtml(p.permitId)} · Issued ${escapeHtml(p.issuedDate || 'unknown')} · ${escapeHtml(p.trade)}</p><p>${escapeHtml(p.description || 'Description not supplied')}</p><dl><dt>Source valuation (not a quote or budget)</dt><dd>${p.valuation == null ? 'Not supplied / source zero' : escapeHtml(new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(p.valuation))} — ${escapeHtml(p.valuationType)}</dd><dt>Owner / candidate name</dt><dd>${escapeHtml(p.owner || 'Not known')}</dd><dt>Mailing address / candidate</dt><dd>${escapeHtml(p.mailingAddress || 'Not known')}</dd><dt>Contractor evidence</dt><dd>${escapeHtml(p.contractor || 'Unknown; not proof of an open project')}</dd><dt>Current review</dt><dd>${escapeHtml(p.reviewStatus)} — ${escapeHtml(p.reviewNote || 'No note')}</dd><dt>Allocation</dt><dd>${escapeHtml(a.allocatedAt)} · UTC week ${escapeHtml(a.weekStart)}</dd></dl><ul>${p.evidence.map(e => `<li>${escapeHtml(e)}</li>`).join('')}</ul><p>Source: <a href="${escapeHtml(source?.url || '')}">${escapeHtml(source?.name)}</a></p></article>`;
    }).join('');
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Permit Atlas — ${escapeHtml(customer.name)}</title><style>body{font:15px/1.6 system-ui,sans-serif;background:#f3f5f3;color:#172b27;max-width:900px;margin:40px auto;padding:0 24px}h1{font-size:36px;letter-spacing:-1px}h2{font-size:23px}.tag{font-size:11px;letter-spacing:1px;font-weight:700;color:#527269}article{background:white;border:1px solid #dce4df;padding:28px;margin:20px 0;border-radius:12px}dt{font-weight:600}dd{margin:0 0 12px}li{margin-bottom:6px}a{color:#287d63}.notice{border-left:3px solid #b48a40;padding:10px 20px;background:#fff8e9}</style></head><body><header><div class="tag">PERMIT ATLAS · LOCAL EXPORT</div><h1>${escapeHtml(customer.name)}</h1><p>Exclusive project allocations · Generated ${escapeHtml(new Date().toISOString())}</p></header><p class="notice">This is a local intelligence digest, not verified open work. No calls, emails, or mail have been sent. Historical samples are explicitly labeled. Assessor enrichment is unverified candidate matching. Source valuations are not quotes, sale prices, or budget floors. A reviewed record is not proof of homeowner identity, availability, or willingness to buy. Allocation reserves a project within this workspace only.</p>${cards || '<p>No projects allocated to this customer.</p>'}</body></html>`;
    res.setHeader('Content-Disposition', 'attachment; filename="permit-atlas-digest.html"'); res.type('html').send(html);
  });
  app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown API endpoint' }));
  if (staticDir && fs.existsSync(path.join(staticDir, 'index.html'))) {
    app.use(express.static(path.resolve(staticDir), { index: false }));
    app.get('*', (req, res) => res.sendFile(path.join(path.resolve(staticDir), 'index.html')));
  }
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.type === 'entity.too.large' ? 413 : error instanceof SyntaxError && 'body' in error ? 400 : error.status || 500;
    res.status(status).json({ error: status === 500 ? 'Local operation failed; stored data was not changed.' : error.message });
  });
  let server;
  try { server = await new Promise((resolve, reject) => { const listening = app.listen(port, host, () => resolve(listening)); listening.once('error', reject); }); }
  catch (error) { store.close(); throw error; }
  return { server, port: server.address().port, async close() { closing = true; await Promise.allSettled([...active]); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); store.close(); } };
}
async function startServer(options = {}) {
  const dataDir = path.resolve(options.dataDir || path.join(os.homedir(), '.permit-atlas'));
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const lockFile = path.join(dataDir, 'backend.lock');
  let lock;
  try { lock = fs.openSync(lockFile, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const pid = Number(fs.readFileSync(lockFile, 'utf8'));
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Workspace lock is invalid; inspect backend.lock before removing it');
    try { process.kill(pid, 0); throw new Error('This workspace already has a backend process'); }
    catch (probe) { if (probe.code !== 'ESRCH') throw probe; }
    fs.unlinkSync(lockFile);
    lock = fs.openSync(lockFile, 'wx', 0o600);
  }
  fs.writeFileSync(lock, String(process.pid));
  const release = () => { fs.closeSync(lock); fs.unlinkSync(lockFile); };
  try {
    const instance = await startWorkspaceServer({ ...options, dataDir });
    const close = instance.close.bind(instance);
    let closing;
    instance.close = () => closing ||= close().finally(release);
    return instance;
  } catch (error) { release(); throw error; }
}
module.exports = { startServer };
