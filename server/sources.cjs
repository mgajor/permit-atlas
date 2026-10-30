'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SOURCES = [
  { id: 'chicago', name: 'Chicago', url: 'https://data.cityofchicago.org/resource/ydr8-5enu.json', date: 'issue_date', order: 'issue_date,permit_,id', description: 'City building permits. Contact roles and licenses are evidence, not proof of availability.' },
  { id: 'seattle', name: 'Seattle', url: 'https://cos-data.seattle.gov/resource/76t5-zqzr.json', date: 'issueddate', order: 'issueddate,permitnum', description: 'City building permits. Missing contractor information does not establish an open project.' },
  { id: 'mesa', name: 'Mesa', url: 'https://citydata.mesaaz.gov/resource/dzpk-hxfb.json', date: 'issued_date', order: 'issued_date,permit_number,rowid', description: 'City building permits. Historical assessor enrichment is an unverified candidate match.' },
  { id: 'phoenix', name: 'Phoenix', url: 'https://apps-secure.phoenix.gov/PDD/Search/IssuedPermit', description: 'Existing workspace records only; live refresh and bundled demos are not supported.' },
];
const text = value => value == null ? '' : String(value).trim();
function projectKey(source, address) {
  const normalized = text(address).normalize('NFKC').toUpperCase().replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();
  return normalized ? `${source}:${normalized}` : '';
}
function trade(description) {
  // Specific work takes precedence over generic references to roofs or remodeling.
  const rules = [['solar', /\bsolar\b|photovoltaic/i], ['pool/spa', /\bpool\b|\bspa\b/i], ['hvac/mech', /\bhvac\b|furnace|air condition|mechanical|\brtu\b|rooftop unit/i], ['roofing', /\broof(?:ing)?\b|re-?roof/i], ['masonry', /\bmasonry\b|tuckpoint|brickwork/i], ['plumbing', /\bplumb|water heater|sewer/i], ['electrical', /\belectrical\b|rewir|panel upgrade/i], ['kitchen/bath', /\bkitchen\b|\bbathroom\b/i], ['garage/accessory', /\bgarage\b|\badu\b|accessory dwelling/i], ['porch/deck', /\bporch\b|\bdeck\b/i], ['demolition', /\bdemoli/i], ['general renovation', /\brenovat|remodel|alteration/i]];
  return rules.find(([, re]) => re.test(description))?.[0] || 'other';
}
function valuation(value) {
  if (value == null || text(value) === '') return null;
  const n = Number(text(value).replace(/[$,]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}
function date(value) {
  const ms = /\/Date\((\d+)\)\//.exec(text(value));
  return ms ? new Date(Number(ms[1])).toISOString().slice(0, 10) : text(value).slice(0, 10);
}
function adapt(source, raw) {
  let permitId, address, issuedDate, description, amount, valuationType, owner = '', mailingAddress = '', contractor = '', zone = '';
  const evidence = ['Availability has not been verified. Missing contractor data does not mean an open project.', 'Permit valuation is a source-reported figure, not a quote, sale price, or budget floor.', 'Trade is a keyword heuristic, not a verified scope: solar and pool/spa precede HVAC, roofing, and other general terms.'];
  if (source === 'chicago') {
    permitId = raw.permit_;
    address = [raw.street_number, raw.street_direction, raw.street_name, raw.street_type].map(text).filter(Boolean).join(' ');
    issuedDate = raw.issue_date; description = raw.work_description; amount = raw.reported_cost; valuationType = 'reported construction cost';
    const names = [];
    for (const key of Object.keys(raw).filter(k => /^contact_\d+_type$/.test(k))) {
      const prefix = key.replace(/type$/, '');
      const role = text(raw[key]); const name = text(raw[`${prefix}name`]);
      if (role || name) evidence.push(`Source contact: ${role || 'role unknown'} — ${name || 'name absent'}.`);
      if (/\bOWNER\b/i.test(role) && name && !owner) owner = name;
      if (/CONTRACTOR|BUILDER|CONSTRUCTION|INSTALLER/i.test(role) && name) names.push(name);
    }
    contractor = [...new Set(names)].join('; ');
    for (const [key, value] of Object.entries(raw)) if (/license/i.test(key) && text(value)) evidence.push(`${key}: ${text(value)} (source license evidence only).`);
    const lat = Number(raw.latitude); zone = raw.latitude ? (lat >= 41.874 && lat <= 41.890 ? 'Loop/Near' : lat > 41.882 ? 'North' : 'South') : '';
  } else if (source === 'seattle') {
    permitId = raw.permitnum; address = raw.originaladdress1; issuedDate = raw.issueddate; description = raw.description;
    contractor = text(raw.contractorcompanyname); amount = null; valuationType = 'not supplied by source';
    const lat = Number(raw.latitude); zone = raw.latitude ? (lat >= 47.591 && lat <= 47.614 ? 'Center' : lat > 47.653 ? 'North' : 'South') : '';
  } else if (source === 'mesa') {
    permitId = raw.permit_number; address = raw.property_address; issuedDate = raw.issued_date; description = raw.description_of_work;
    amount = raw.icc_value; valuationType = 'ICC source valuation'; contractor = text(raw.contractor_name);
    if (raw.contractor_license) evidence.push(`Source contractor license: ${raw.contractor_license}; not proof of availability.`);
    zone = raw.council_district ? `District ${raw.council_district}` : '';
  }
  evidence.unshift(`Official source: ${SOURCES.find(s => s.id === source).url}; retrieved ${new Date().toISOString()}.`);
  if (contractor) evidence.push('Named contractor is source evidence only; no contact, availability, or license verification performed.');
  const idPart = text(permitId) || `missing-${crypto.createHash('sha256').update(JSON.stringify(raw)).digest('hex').slice(0, 24)}`;
  return { id: `${source}:${idPart}`, source, permitId: text(permitId), address: text(address), issuedDate: date(issuedDate), trade: trade(text(description)), zone: text(zone), valuation: valuation(amount), valuationType, owner: text(owner), mailingAddress: text(mailingAddress), contractorStatus: contractor ? 'named' : 'unknown', contractor, evidence, description: text(description), reviewStatus: 'pending', reviewNote: '', importedAt: new Date().toISOString(), historical: false, synthetic: false, raw, projectKey: projectKey(source, address) };
}
function samples() {
  const rows = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'samples', 'fixtures.json'), 'utf8'));
  if (!Array.isArray(rows)) throw new Error('Invalid synthetic fixtures');
  return rows.map(raw => {
    if (!raw || raw.synthetic !== true || !['chicago', 'seattle', 'mesa'].includes(raw.source) || !/^DEMO-[A-Z0-9-]+$/.test(raw.permitId)) throw new Error('Invalid synthetic fixture record');
    const description = text(raw.description);
    const contractor = text(raw.contractor);
    return {
      id: `${raw.source}:${raw.permitId}`, source: raw.source, permitId: raw.permitId,
      address: text(raw.address), issuedDate: date(raw.issuedDate), trade: trade(description), zone: text(raw.zone),
      valuation: valuation(raw.valuation), valuationType: 'synthetic demonstration value; not a source valuation',
      owner: text(raw.owner), mailingAddress: text(raw.mailingAddress), contractor, contractorStatus: contractor ? 'named' : 'unknown',
      description, reviewStatus: 'pending', reviewNote: '', importedAt: new Date().toISOString(), historical: false, synthetic: true,
      evidence: ['SYNTHETIC DEMONSTRATION ONLY: fictional people, permits, and nonmailable addresses. Never use for live outreach.', 'Availability is unknown. Missing contractor data does not establish an open project.', 'Trade is a keyword heuristic: solar and pool/spa precede HVAC, roofing, and other general terms.', ...(Array.isArray(raw.evidence) ? raw.evidence.map(value => `SYNTHETIC: ${text(value)}`) : [])],
      raw: { ...raw, synthetic: true }, projectKey: projectKey(raw.source, raw.address),
    };
  });
}
async function fetchRecords(source, days) {
  const cfg = SOURCES.find(s => s.id === source && s.date);
  if (!cfg) throw new Error('Unsupported live source');
  const end = new Date(); end.setUTCHours(0, 0, 0, 0); end.setUTCDate(end.getUTCDate() + 1);
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - days);
  const where = `${cfg.date} >= '${start.toISOString().slice(0, 19)}' AND ${cfg.date} < '${end.toISOString().slice(0, 19)}'`;
  const rows = [];
  for (let offset = 0; offset <= 10000; offset += 1000) {
    const url = new URL(cfg.url);
    url.search = new URLSearchParams({ '$where': where, '$order': cfg.order, '$limit': offset === 10000 ? '1' : '1000', '$offset': String(offset) });
    const response = await fetch(url, { signal: AbortSignal.timeout(25000), headers: { Accept: 'application/json' }, redirect: 'error' });
    if (!response.ok) throw new Error(`Source returned HTTP ${response.status}`);
    const body = await response.text();
    if (body.length > 20 * 1024 * 1024) throw new Error('Source page exceeds safe response size');
    const page = JSON.parse(body);
    if (!Array.isArray(page) || page.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('Source returned invalid records');
    if (offset === 10000 && page.length) throw new Error('Incomplete refresh: more than 10,000 records in this date window. Choose a shorter window. No permit data changed.');
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows.map(raw => adapt(source, raw));
}
module.exports = { SOURCES, samples, fetchRecords, projectKey };
