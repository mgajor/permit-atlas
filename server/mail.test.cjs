'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { openMail } = require('./mail.cjs');

// A genuine compressed PNG, rather than only a forged dimension header.
function png(width = 1875, height = 1275) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of body) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, body, checksum]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const data = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(Buffer.alloc((width * 3 + 1) * height))), chunk('IEND', Buffer.alloc(0))]);
  return { name: 'synthetic-art.png', dataUrl: `data:image/png;base64,${data.toString('base64')}` };
}
const art = png();
const address = { name: 'Synthetic Test', address_line1: '123 Test St', address_line2: '', address_city: 'Lob Test', address_state: 'CA', address_zip: '94107' };
const confirmation = { confirmation: 'SEND TEST POSTCARDS', maxSpendCents: 200, acknowledgeEstimate: true, acknowledgeCompliance: true };
async function fixture(t, options = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'permit-atlas-mail-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const permits = [{ id: 'synthetic-permit', reviewStatus: 'approved', synthetic: true }];
  const store = { state: () => ({ permits }) };
  const mail = await openMail({ dataDir, store, ...options });
  await mail.setKey({ mode: 'test', key: 'test_synthetic12345678' });
  const input = { permitIds: ['synthetic-permit'], name: 'Synthetic test', front: art, back: art, sender: address, recipients: [{ ...address, permitId: 'synthetic-permit', reviewed: true }], unitEstimateCents: 200 };
  return { mail, input, permits, dataDir, store };
}

test('concurrent and subsequent submits cannot purchase a batch twice', async t => {
  let calls = 0, complete;
  const blocked = new Promise(resolve => { complete = resolve; });
  const { mail, input } = await fixture(t, { transport: async () => { calls++; await blocked; return Response.json({ id: 'psc_synthetic1', status: 'processed' }); } });
  const batch = mail.create(input);
  const first = mail.submit(batch.id, confirmation);
  await assert.rejects(mail.submit(batch.id, confirmation), { status: 409 });
  complete();
  assert.equal((await first).status, 'submitted');
  await assert.rejects(mail.submit(batch.id, confirmation), { status: 409 });
  assert.equal(calls, 1);
});

test('timeout remains uncertain after reopening and cannot be blindly retried', async t => {
  let calls = 0;
  const fixtureData = await fixture(t, { timeoutMs: 5, transport: async () => { calls++; return new Promise(() => {}); } });
  const { mail, input, dataDir, store } = fixtureData;
  const batch = mail.create(input);
  const result = await mail.submit(batch.id, confirmation);
  assert.equal(result.status, 'uncertain');
  assert.equal(result.items[0].status, 'uncertain');
  const reopened = await openMail({ dataDir, store, transport: async () => { calls++; throw new Error('must not retry'); } });
  await reopened.setKey({ mode: 'test', key: 'test_synthetic12345678' });
  await assert.rejects(reopened.submit(batch.id, confirmation), { status: 409 });
  await assert.rejects(reopened.refresh(batch.id), { status: 409 });
  assert.equal(calls, 1);
  assert.equal(reopened.status().batches[0].status, 'uncertain');
  assert.equal(fs.readFileSync(path.join(dataDir, 'mail-outbox.json'), 'utf8').includes('test_synthetic12345678'), false);
});

test('review and artwork validation fail before any provider operation', async t => {
  let calls = 0;
  const { mail, input, permits } = await fixture(t, { transport: async () => { calls++; throw new Error('not expected'); } });
  assert.throws(() => mail.create({ ...input, recipients: [{ ...input.recipients[0], reviewed: false }] }), { status: 400 });
  assert.throws(() => mail.create({ ...input, front: png(100, 100) }), { status: 400 });
  assert.throws(() => mail.create({ ...input, back: { name: 'bad.png', dataUrl: 'data:image/png;base64,bm90YW5pbWFnZQ==' } }), { status: 400 });
  const batch = mail.create(input);
  permits[0].reviewStatus = 'pending';
  await assert.rejects(mail.submit(batch.id, confirmation), { status: 409 });
  permits[0].reviewStatus = 'approved';
  await assert.rejects(mail.submit(batch.id, { ...confirmation, maxSpendCents: 199 }), { status: 400 });
  assert.equal(calls, 0);
  assert.equal(mail.status().batches[0].status, 'draft');
});

test('provider rejection is real failure with no secret or address reflection', async t => {
  const { mail, input } = await fixture(t, { transport: async () => Response.json({ error: { message: 'test_synthetic12345678 123 Test St' } }, { status: 422 }) });
  const result = await mail.submit(mail.create(input).id, confirmation);
  assert.equal(result.status, 'failed');
  assert.match(result.error, /HTTP 422/);
  assert.doesNotMatch(result.error, /test_synthetic|123 Test/);
});

test('provider refresh only reconciles known IDs without creating more postcards', async t => {
  let creates = 0, reads = 0;
  const { mail, input } = await fixture(t, { transport: async (url, options) => {
    if (options.method === 'POST') { creates++; return Response.json({ id: 'psc_synthetic2', status: 'processed' }); }
    reads++; return Response.json({ id: 'psc_synthetic2', status: 'failed' });
  } });
  const batch = await mail.submit(mail.create(input).id, confirmation);
  const refreshed = await mail.refresh(batch.id);
  assert.equal(refreshed.status, 'failed');
  assert.equal(refreshed.items[0].providerStatus, 'failed');
  assert.equal(creates, 1); assert.equal(reads, 1);
});

test('interrupted durable submissions become uncertain on startup', async t => {
  const { mail, input, store, dataDir } = await fixture(t);
  const batch = mail.create(input);
  const file = path.join(dataDir, 'mail-outbox.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  saved.batches[0].status = 'submitting'; saved.batches[0].items[0].status = 'submitting';
  fs.writeFileSync(file, JSON.stringify(saved));
  const reopened = await openMail({ dataDir, store });
  assert.equal(reopened.status().batches[0].status, 'uncertain');
  assert.equal(reopened.status().batches[0].items[0].status, 'uncertain');
  await assert.rejects(reopened.submit(batch.id, confirmation), { status: 409 });
});

test('live opt-in and matching key never authorize synthetic mail', async t => {
  const previous = process.env.PERMIT_ATLAS_ALLOW_LIVE_MAIL;
  t.after(() => { if (previous === undefined) delete process.env.PERMIT_ATLAS_ALLOW_LIVE_MAIL; else process.env.PERMIT_ATLAS_ALLOW_LIVE_MAIL = previous; });
  delete process.env.PERMIT_ATLAS_ALLOW_LIVE_MAIL;
  let calls = 0;
  const { mail, input } = await fixture(t, { transport: async () => { calls++; throw new Error('not expected'); } });
  await assert.rejects(mail.setKey({ mode: 'test', key: 'live_synthetic12345678' }), { status: 400 });
  await assert.rejects(mail.setKey({ mode: 'live', key: 'live_synthetic12345678' }), { status: 403 });
  process.env.PERMIT_ATLAS_ALLOW_LIVE_MAIL = '1';
  await mail.setKey({ mode: 'live', key: 'live_synthetic12345678' });
  assert.throws(() => mail.create(input), { status: 409 });
  assert.equal(calls, 0);
  assert.equal(mail.status().batches.length, 0);
});

test('overlapping drafts cannot spend twice across batches or project aliases', async t => {
  let calls = 0, complete;
  const blocked = new Promise(resolve => { complete = resolve; });
  const { mail, input, permits } = await fixture(t, { transport: async () => { calls++; await blocked; return Response.json({ id: 'psc_reserved', status: 'processed' }); } });
  permits[0].projectKey = 'synthetic-project';
  permits.push({ id: 'synthetic-alias', projectKey: 'synthetic-project', reviewStatus: 'approved', synthetic: true });
  const first = mail.create(input);
  const overlapping = mail.create(input);
  const alias = mail.create({ ...input, permitIds: ['synthetic-alias'], recipients: [{ ...input.recipients[0], permitId: 'synthetic-alias' }] });
  const sending = mail.submit(first.id, confirmation);
  await assert.rejects(mail.submit(overlapping.id, confirmation), { status: 409 });
  await assert.rejects(mail.submit(alias.id, confirmation), { status: 409 });
  complete();
  await sending;
  await assert.rejects(mail.submit(mail.create(input).id, confirmation), { status: 409 });
  assert.equal(calls, 1);
});

test('uncertain reservation prevents new-batch retry even after restart', async t => {
  let calls = 0;
  const { mail, input, dataDir, store } = await fixture(t, { timeoutMs: 5, transport: async () => { calls++; return new Promise(() => {}); } });
  const first = await mail.submit(mail.create(input).id, confirmation);
  assert.equal(first.status, 'uncertain');
  const reopened = await openMail({ dataDir, store, transport: async () => { calls++; throw new Error('not expected'); } });
  await reopened.setKey({ mode: 'test', key: 'test_synthetic12345678' });
  await assert.rejects(reopened.submit(reopened.create(input).id, confirmation), { status: 409 });
  assert.equal(calls, 1);
});
