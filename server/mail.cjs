'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { imageSize } = require('image-size');
const { fail } = require('./store.cjs');
const MAX_IMAGE = 5 * 1024 * 1024;
const STATES = new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY AS GU MP PR VI'.split(' '));
function text(value, label, max = 200, optional = false) {
  if (optional && (value === undefined || value === '')) return '';
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) throw fail(`${label} must be a non-empty single-line string of at most ${max} characters`);
  return value.trim();
}
function address(input, label) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail(`${label} address is required`);
  const result = {
    name: text(input.name, `${label} name`, 40),
    address_line1: text(input.address_line1, `${label} street`, 64),
    address_line2: text(input.address_line2, `${label} address line 2`, 64, true),
    address_city: text(input.address_city, `${label} city`, 200),
    address_state: text(input.address_state, `${label} state`, 2).toUpperCase(),
    address_zip: text(input.address_zip, `${label} ZIP`, 10),
  };
  if (!STATES.has(result.address_state) || !/^\d{5}(-\d{4})?$/.test(result.address_zip)) throw fail(`${label} requires a valid US state and ZIP code`);
  return result;
}
function artwork(input, label) {
  const name = text(input?.name, `${label} filename`, 150);
  if (typeof input.dataUrl !== 'string' || input.dataUrl.length > Math.ceil(MAX_IMAGE / 3) * 4 + 40) throw fail(`${label} must be a PNG or JPEG of at most 5 MiB`);
  const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(input.dataUrl);
  if (!match) throw fail(`${label} must be a base64 PNG or JPEG data URL`);
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE || bytes.toString('base64') !== match[2]) throw fail(`${label} image encoding or size is invalid`);
  let dimensions;
  try { dimensions = imageSize(bytes); } catch { throw fail(`${label} image could not be read`); }
  if (dimensions.type !== (match[1] === 'jpeg' ? 'jpg' : 'png')) throw fail(`${label} image content does not match its MIME type`);
  // 6.25 x 4.25 inches including bleed, at 300 dpi. Reject rather than silently crop.
  if (dimensions.width !== 1875 || dimensions.height !== 1275) throw fail(`${label} must be 1875 × 1275 pixels (6.25 × 4.25 inches including bleed at 300 dpi)`);
  return { name, dataUrl: input.dataUrl, width: dimensions.width, height: dimensions.height };
}
function validCredential(value) {
  return value && ['test', 'live'].includes(value.mode) && typeof value.key === 'string' && new RegExp(`^${value.mode}_[A-Za-z0-9]{8,200}$`).test(value.key);
}
function publicBatch(batch) {
  const { front, back, ...rest } = batch;
  return structuredClone({ ...rest, front: { name: front.name, width: front.width, height: front.height }, back: { name: back.name, width: back.width, height: back.height } });
}
function isSample(permit) {
  return permit.synthetic === true || permit.historical === true || permit.sample === true || permit.isSample === true || permit.raw?._historicalSample || permit.raw?._synthetic === true;
}
async function openMail({ dataDir, store, credentialStore, transport = fetch, timeoutMs = 30000 }) {
  const file = path.join(dataDir, 'mail-outbox.json');
  let batches = [];
  if (fs.existsSync(file)) {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (saved.version !== 1 || !Array.isArray(saved.batches)) throw new Error('Unsupported mail outbox');
    batches = saved.batches;
  }
  function persist() {
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    try {
      const fd = fs.openSync(temporary, 'wx', 0o600);
      try { fs.writeFileSync(fd, JSON.stringify({ version: 1, batches })); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(temporary, file);
      const directory = fs.openSync(dataDir, 'r');
      try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  let interrupted = false;
  for (const batch of batches) if (batch.status === 'submitting') {
    batch.status = 'uncertain'; batch.error = 'Submission interrupted. Check Lob account and known provider IDs; do not recreate or retry without reconciliation.';
    for (const item of batch.items) if (item.status === 'submitting') { item.status = 'uncertain'; item.error = batch.error; }
    interrupted = true;
  }
  if (interrupted) persist();
  let credential = credentialStore ? await credentialStore.get() : null;
  if (!validCredential(credential)) credential = null;
  const busy = new Set();
  const liveAllowed = () => process.env.PERMIT_ATLAS_ALLOW_LIVE_MAIL === '1';
  const find = id => { const batch = batches.find(value => value.id === id); if (!batch) throw fail('Mail batch not found', 404); return batch; };
  function checkPermits(ids, mode) {
    const permits = new Map(store.state().permits.map(permit => [permit.id, permit]));
    for (const id of ids) {
      const permit = permits.get(id);
      if (!permit || permit.reviewStatus !== 'approved') throw fail('Every selected permit must currently be approved', 409);
      if (mode === 'live' && isSample(permit)) throw fail('Synthetic or historical sample permits cannot be mailed in live mode', 409);
    }
  }
  function keyFor(mode) {
    if (!credential || credential.mode !== mode) throw fail(`Configure a ${mode} Lob key first`, 409);
    if (mode === 'live' && !liveAllowed()) throw fail('Live mail is disabled; enable PERMIT_ATLAS_ALLOW_LIVE_MAIL=1 on the server', 403);
    return credential.key;
  }
  async function request(suffix, options, key) {
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(fail('Lob request timed out; outcome is unknown. Reconcile in the Lob account before any further purchase.', 504)); }, timeoutMs); });
    try {
      return await Promise.race([timeout, (async () => {
        const response = await transport(`https://api.lob.com/v1/postcards${suffix}`, { ...options, redirect: 'error', signal: controller.signal, headers: { ...options.headers, Authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}` } });
        if (!response.ok) {
          const error = fail(`Lob returned HTTP ${Number(response.status) || 'error'}. Review the provider account; provider response details are not stored locally.`, 502);
          error.definite = response.status >= 400 && response.status < 500 && ![408, 409, 429].includes(response.status);
          throw error;
        }
        const body = await response.json();
        if (!/^psc_[A-Za-z0-9]+$/.test(body?.id)) throw fail('Lob response did not include a valid postcard ID; reconcile in the provider account.', 502);
        return { id: body.id, status: ['processed', 'rendered', 'failed'].includes(body.status) ? body.status : 'unknown', expectedDeliveryDate: /^\d{4}-\d{2}-\d{2}$/.test(body.expected_delivery_date) ? body.expected_delivery_date : null };
      })()]);
    } catch (error) {
      if (error.status && /^Lob /.test(error.message)) throw error;
      throw fail('Lob connection or response failed; outcome may be unknown. Reconcile in the Lob account before any further purchase.', 502);
    } finally { clearTimeout(timer); }
  }
  return {
    status() { return { configured: Boolean(credential), mode: credential?.mode || 'test', storage: credentialStore ? 'credential-store' : 'session', liveAllowed: liveAllowed(), batches: batches.map(publicBatch).reverse() }; },
    artwork(id, side) {
      if (!['front', 'back'].includes(side)) throw fail('Unknown artwork side', 404);
      const art = find(id)[side];
      const [header, encoded] = art.dataUrl.split(',');
      return { bytes: Buffer.from(encoded, 'base64'), type: header.includes('image/png') ? 'image/png' : 'image/jpeg' };
    },
    async setKey(value) {
      if (!validCredential(value)) throw fail('Lob key must match the selected test_ or live_ mode');
      if (value.mode === 'live' && !liveAllowed()) throw fail('Live mail is disabled on this server', 403);
      const next = { key: value.key, mode: value.mode };
      if (credentialStore) { try { await credentialStore.set(next); } catch { throw fail('Secure credential storage failed', 503); } }
      credential = next;
      return this.status();
    },
    async deleteKey() {
      if (credentialStore) { try { await credentialStore.delete(); } catch { throw fail('Secure credential deletion failed', 503); } }
      credential = null;
      return this.status();
    },
    create(input) {
      if (!input || !Array.isArray(input.permitIds) || input.permitIds.length < 1 || input.permitIds.length > 50 || input.permitIds.some(id => typeof id !== 'string' || !id || id.length > 250) || new Set(input.permitIds).size !== input.permitIds.length) throw fail('Select 1–50 unique permit IDs');
      const mode = credential?.mode || 'test';
      checkPermits(input.permitIds, mode);
      if (!Array.isArray(input.recipients) || input.recipients.length !== input.permitIds.length) throw fail('Provide one reviewed recipient per permit');
      const remaining = new Set(input.permitIds);
      const recipients = input.recipients.map(recipient => {
        if (!recipient || !remaining.delete(recipient.permitId) || recipient.reviewed !== true) throw fail('Each permit needs exactly one explicitly reviewed recipient');
        return { permitId: recipient.permitId, ...address(recipient, 'Recipient'), reviewed: true };
      });
      if (!Number.isSafeInteger(input.unitEstimateCents) || input.unitEstimateCents < 1 || input.unitEstimateCents > 1000000) throw fail('Unit estimate must be an integer from 1 to 1000000 cents');
      const batch = { id: crypto.randomUUID(), name: text(input.name, 'Batch name'), mode, status: 'draft', createdAt: new Date().toISOString(), permitIds: [...input.permitIds], recipients, sender: address(input.sender, 'Sender'), front: artwork(input.front, 'Front'), back: artwork(input.back, 'Back'), count: recipients.length, unitEstimateCents: input.unitEstimateCents, estimatedTotalCents: recipients.length * input.unitEstimateCents, estimateNotice: 'Operator estimate only, not a Lob quote or guaranteed spend cap. Use provider account spending controls.', items: [], error: null };
      batch.items = recipients.map(recipient => ({ permitId: recipient.permitId, idempotencyKey: crypto.createHash('sha256').update(`permit-atlas:${batch.id}:${recipient.permitId}`).digest('hex'), status: 'queued', providerId: null, providerStatus: null, error: null }));
      batches.push(batch);
      try { persist(); } catch (error) { batches.pop(); throw error; }
      return publicBatch(batch);
    },
    async submit(id, input) {
      const batch = find(id);
      if (batch.status !== 'draft' || busy.has(id)) throw fail('Batch has already been attempted; automatic retries are prohibited. Refresh known provider IDs and reconcile in Lob.', 409);
      const key = keyFor(batch.mode);
      checkPermits(batch.permitIds, batch.mode);
      const confirmation = batch.mode === 'live' ? 'PURCHASE LIVE POSTCARDS' : 'SEND TEST POSTCARDS';
      if (input?.confirmation !== confirmation || input.acknowledgeEstimate !== true || input.acknowledgeCompliance !== true) throw fail('Exact confirmation and estimate/compliance acknowledgements are required');
      if (!Number.isSafeInteger(input.maxSpendCents) || input.maxSpendCents < batch.estimatedTotalCents) throw fail('Acknowledged estimate ceiling must cover the operator estimate; this is not a provider-enforced cap');
      const currentPermits = new Map(store.state().permits.map(permit => [permit.id, permit]));
      const projectKeys = new Set(batch.permitIds.map(permitId => currentPermits.get(permitId)?.projectKey).filter(Boolean));
      const permitIds = new Set(batch.permitIds);
      for (const previous of batches) {
        if (previous.id === batch.id || previous.status === 'draft') continue;
        const previousProjects = previous.projectKeys || previous.permitIds.map(permitId => currentPermits.get(permitId)?.projectKey).filter(Boolean);
        if (previous.permitIds.some(permitId => permitIds.has(permitId)) || previousProjects.some(projectKey => projectKeys.has(projectKey))) throw fail('A permit or project in this batch already belongs to an attempted mail batch. Reconcile that batch in Lob before further mailing.', 409);
      }
      // Snapshot reservations durably with submitting status before any provider await.
      batch.projectKeys = [...projectKeys];
      busy.add(id);
      try {
        batch.status = 'submitting'; persist();
        for (const item of batch.items) {
          const recipient = batch.recipients.find(value => value.permitId === item.permitId);
          const form = new FormData();
          for (const [prefix, value] of [['to', recipient], ['from', batch.sender]]) for (const field of ['name', 'address_line1', 'address_line2', 'address_city', 'address_state', 'address_zip']) if (value[field]) form.append(`${prefix}[${field}]`, value[field]);
          for (const side of ['front', 'back']) {
            const art = batch[side]; const [header, encoded] = art.dataUrl.split(',');
            const mime = header.includes('image/png') ? 'image/png' : 'image/jpeg';
            form.append(side, new Blob([Buffer.from(encoded, 'base64')], { type: mime }), `${side}.${mime === 'image/png' ? 'png' : 'jpg'}`);
          }
          form.append('size', '4x6'); form.append('use_type', 'marketing'); form.append('mail_type', 'usps_first_class');
          form.append('metadata[permit_atlas_item]', item.idempotencyKey);
          item.status = 'submitting'; persist();
          try {
            const result = await request('', { method: 'POST', body: form, headers: { 'Idempotency-Key': item.idempotencyKey } }, key);
            item.providerId = result.id; item.providerStatus = result.status; item.expectedDeliveryDate = result.expectedDeliveryDate;
            item.status = result.status === 'failed' ? 'failed' : 'submitted';
            if (item.status === 'failed') { item.error = 'Lob reported postcard rendering failure; check the provider account.'; batch.error = item.error; batch.status = 'failed'; persist(); break; }
            persist();
          } catch (error) {
            item.status = error.definite ? 'failed' : 'uncertain';
            item.error = error.status ? error.message : 'Local progress could not be saved after provider contact; reconcile in Lob.';
            batch.status = item.status; batch.error = item.error;
            persist(); break;
          }
        }
        if (batch.items.every(item => item.status === 'submitted')) batch.status = 'submitted';
        persist();
        return publicBatch(batch);
      } finally { busy.delete(id); }
    },
    async refresh(id) {
      const batch = find(id);
      if (busy.has(id)) throw fail('Mail batch is currently busy', 409);
      const key = keyFor(batch.mode);
      if (!batch.items.some(item => item.providerId)) throw fail('No provider IDs are known. Reconcile manually in the Lob account; no automatic retry is allowed.', 409);
      busy.add(id);
      try {
        for (const item of batch.items) if (item.providerId) {
          const result = await request(`/${encodeURIComponent(item.providerId)}`, { method: 'GET' }, key);
          if (result.id !== item.providerId) throw fail('Lob returned a different postcard ID', 502);
          item.providerStatus = result.status; item.expectedDeliveryDate = result.expectedDeliveryDate;
          item.status = result.status === 'failed' ? 'failed' : 'submitted';
          item.error = result.status === 'failed' ? 'Lob reported postcard rendering failure; check the provider account.' : null;
          persist();
        }
        if (batch.items.some(item => item.status === 'uncertain')) batch.status = 'uncertain';
        else if (batch.items.some(item => item.status === 'failed')) batch.status = 'failed';
        else if (batch.items.every(item => item.status === 'submitted')) { batch.status = 'submitted'; batch.error = null; }
        persist(); return publicBatch(batch);
      } finally { busy.delete(id); }
    },
  };
}
module.exports = { openMail };
