import React, { useEffect, useMemo, useState } from 'react';
import { CircleAlert, Mail as MailIcon, RefreshCw, ShieldCheck } from 'lucide-react';
import './mail.css';

const blankAddress = () => ({ name: '', address_line1: '', address_line2: '', address_city: '', address_state: '', address_zip: '' });
const fields = [['name', 'Recipient / organization'], ['address_line1', 'Street address'], ['address_line2', 'Unit / suite (optional)'], ['address_city', 'City'], ['address_state', 'State'], ['address_zip', 'ZIP code']];
const dollars = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(cents || 0) / 100);
async function request(path, method = 'GET', body) {
  const response = await fetch(`/api/mail/${path}`, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Mail request failed (${response.status}).`);
  return result;
}
function AddressFields({ value, onChange, sender = false }) {
  return <div className="mail-address-fields">{fields.map(([key, title]) => <label key={key}>{sender && key === 'name' ? 'Sender / organization' : title}<input required={key !== 'address_line2'} autoComplete="off" maxLength={key === 'address_state' ? 2 : key === 'address_zip' ? 10 : 150} value={value[key] || ''} onChange={event => onChange({ ...value, [key]: key === 'address_state' ? event.target.value.toUpperCase() : event.target.value })} /></label>)}</div>;
}
function Address({ value }) {
  return <address>{value.name}<br />{value.address_line1}{value.address_line2 && <><br />{value.address_line2}</>}<br />{value.address_city}, {value.address_state} {value.address_zip}</address>;
}
function Artwork({ side, value, onChange, onError }) {
  async function upload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (!['image/png', 'image/jpeg'].includes(file.type)) throw new Error('Artwork must be a PNG or JPEG image. HTML is not supported.');
      if (file.size > 5 * 1024 * 1024) throw new Error('Each artwork image must be 5 MB or smaller.');
      const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Unable to read artwork.')); reader.readAsDataURL(file); });
      const image = await new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('Unable to decode artwork as an image.')); image.src = dataUrl; });
      onChange({ name: file.name, dataUrl, width: image.naturalWidth, height: image.naturalHeight });
    } catch (error) { onError(error.message); event.target.value = ''; }
  }
  return <div className="mail-artwork"><label>{side} artwork<input type="file" accept="image/png,image/jpeg" onChange={upload} /></label>{value ? <><img src={value.dataUrl} alt={`${side} postcard artwork preview`} /><p>{value.name} · {value.width} × {value.height} px</p>{(value.width !== 1875 || value.height !== 1275) && <p className="inline-warning">Recommended: 1875 × 1275 pixels. Server checks print dimensions before a draft is accepted.</p>}</> : <div className="mail-art-placeholder">{side} preview · 6.25 × 4.25 in with bleed</div>}</div>;
}

export default function Mail({ permits, selectedIds, onToast }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState('');
  const [mode, setMode] = useState('test');
  const [name, setName] = useState('');
  const [front, setFront] = useState(null);
  const [back, setBack] = useState(null);
  const [sender, setSender] = useState(blankAddress);
  const [recipients, setRecipients] = useState([]);
  const [unitEstimate, setUnitEstimate] = useState('');
  const [activeId, setActiveId] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [maxSpend, setMaxSpend] = useState('');
  const [estimateAck, setEstimateAck] = useState(false);
  const [complianceAck, setComplianceAck] = useState(false);
  const [loadedArtwork, setLoadedArtwork] = useState([]);
  const selected = useMemo(() => permits.filter(p => selectedIds.includes(p.id)), [permits, selectedIds]);
  const approved = selected.filter(p => p.reviewStatus === 'approved');
  const selectedSignature = approved.map(p => p.id).join('\u0000');
  useEffect(() => { setRecipients(current => approved.map(p => current.find(r => r.permitId === p.id) || { ...blankAddress(), permitId: p.id, reviewed: false })); }, [selectedSignature]);
  async function refresh() { const result = await request('status'); setStatus(result); return result; }
  useEffect(() => { refresh().catch(e => setError(e.message)); }, []);
  async function run(action) {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); } catch (e) { setError(e.message); onToast?.({ error: true, text: e.message }); await refresh().catch(() => {}); } finally { setBusy(false); }
  }
  const batches = status?.batches || [];
  const active = batches.find(batch => batch.id === activeId);
  const requiredConfirmation = active?.mode === 'live' ? 'PURCHASE LIVE POSTCARDS' : 'SEND TEST POSTCARDS';
  function selectBatch(id) { setActiveId(id); setConfirmation(''); setEstimateAck(false); setComplianceAck(false); setMaxSpend(''); if (id !== activeId) setLoadedArtwork([]); }
  async function createDraft(event) {
    event.preventDefault();
    await run(async () => {
      if (!front || !back) throw new Error('Upload both front and back artwork before creating a draft.');
      if (!recipients.length || approved.length !== selected.length) throw new Error('Select only approved permits in the explorer.');
      if (recipients.some(r => !r.reviewed)) throw new Error('Review every recipient and mailing address first.');
      const result = await request('batches', 'POST', { permitIds: approved.map(p => p.id), name, front: { name: front.name, dataUrl: front.dataUrl }, back: { name: back.name, dataUrl: back.dataUrl }, sender, recipients, unitEstimateCents: Number(unitEstimate) });
      const updated = await refresh();
      selectBatch((result.batch || result).id || updated.batches?.[0]?.id || '');
      onToast?.({ text: 'Draft saved. No postcards have been sent.' });
    });
  }
  return <div className="mail-workspace">
    <div className="page-heading"><div><div className="eyebrow">EXPLICIT REVIEW. EXPLICIT SEND.</div><h1>Direct mail</h1><p>A reviewed postcard queue, never automatic outreach.</p></div><span className="chip neutral"><MailIcon size={14} />{status?.mode === 'live' ? 'Live purchase mode' : 'Test mode by default'}</span></div>
    {error && <div className="error-banner" role="alert"><CircleAlert size={18} /><span>{error}</span></div>}
    <section className="panel mail-section"><div className="mail-section-head"><div><h2>1. Connect Lob</h2><p>Test credentials do not purchase live mail. Keys are never returned to this screen.</p></div><button className="button" disabled={busy} onClick={() => run(refresh)}><RefreshCw size={14} />Refresh status</button></div>
      <div className="mail-storage"><ShieldCheck size={16} /><span>{status ? `${status.configured ? 'Credential configured' : 'No credential configured'} · Storage: ${status.storage === 'session' ? 'session-only memory' : status.storage === 'credential-store' ? 'OS-encrypted credential store' : status.storage || 'session-only'}` : 'Checking credential storage…'}. Session-only keys disappear when the backend exits. OS-encrypted storage is used only when available.</span></div>
      <form className="mail-credentials" onSubmit={event => { event.preventDefault(); run(async () => { await request('key', 'POST', { key, mode }); setKey(''); await refresh(); }); }}>
        <label>Lob secret API key<input type="password" autoComplete="off" value={key} onChange={event => setKey(event.target.value)} required placeholder="Enter test key" /></label>
        <label>Credential mode<select value={mode} onChange={event => setMode(event.target.value)}><option value="test">Test — no live purchase</option><option value="live" disabled={status?.liveAllowed !== true}>Live — purchases physical postcards</option></select></label>
        <button className="button primary" disabled={busy || !status || !key.trim()} type="submit">Save credential</button><button className="button" type="button" disabled={busy || !status?.configured} onClick={() => run(async () => { await request('key', 'DELETE'); setKey(''); setMode('test'); await refresh(); })}>Clear credential</button>
      </form><p className="mail-help">Live mode requires PERMIT_ATLAS_ALLOW_LIVE_MAIL=1 on the server and a live Lob credential. Synthetic demonstrations can be used only in test mode. Saving a key never sends mail.</p>
    </section>
    <form className="panel mail-section" onSubmit={createDraft}>
      <div className="mail-section-head"><div><h2>2. Prepare a draft</h2><p>{approved.length} approved of {selected.length} selected records from Permit explorer. No mailbox is inferred from source text.</p></div></div>
      {selected.length !== approved.length && <p className="inline-warning">Unapproved selections cannot be queued. Return to the explorer to review them or change the selection.</p>}
      <div className="mail-form-row"><label>Batch name<input required maxLength={150} value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Reviewed October test" /></label><label>Operator estimate per card (cents)<input required type="number" min="1" step="1" value={unitEstimate} onChange={event => setUnitEstimate(event.target.value)} placeholder="Enter your own estimate" /></label></div>
      <p className="mail-help">Estimated total: <strong>{dollars(Number(unitEstimate) * recipients.length)}</strong>. This is your estimate, not a Lob quote or a guaranteed spending limit. Configure provider account controls separately.</p>
      <h3>4 × 6 postcard artwork</h3><p className="mail-help">PNG or JPEG only, at most 5 MB per side. Recommended 1875 × 1275 px at 300 dpi (6.25 × 4.25 in including bleed). Keep important content inside the trim and reserve the back address/postage area according to Lob’s current template. Review both sides before sending.</p>
      <div className="mail-art-grid"><Artwork side="Front" value={front} onChange={setFront} onError={setError} /><Artwork side="Back" value={back} onChange={setBack} onError={setError} /></div>
      <fieldset className="mail-fieldset"><legend>Return address</legend><AddressFields value={sender} onChange={setSender} sender /></fieldset>
      <h3>Recipient evidence & mailing review</h3><p className="mail-help">Enter each structured mailing address yourself. Source owners and candidate addresses are unverified evidence, not pre-approved delivery instructions. Editing an address clears its review.</p>
      {!recipients.length && <div className="quiet-empty">Select approved records in Permit explorer, then choose “Prepare direct mail.”</div>}
      {recipients.map((recipient, index) => { const permit = permits.find(p => p.id === recipient.permitId); return <fieldset className="mail-fieldset" key={recipient.permitId}><legend>Recipient {index + 1} · {permit?.permitId || recipient.permitId}</legend><div className="mail-evidence"><strong>{permit?.address || 'No project address'}</strong>{permit?.synthetic && <span className="chip historical">Synthetic demo · test only</span>}<p>Source owner / candidate: {permit?.owner || 'Not provided'}<br />Source candidate mailing: {permit?.mailingAddress || 'Not provided'}</p><ul>{(permit?.evidence || []).map((item, i) => <li key={i}>{typeof item === 'string' ? item : JSON.stringify(item)}</li>)}</ul>{!permit?.evidence?.length && <p>No additional evidence attached. Verify the original source independently.</p>}</div><AddressFields value={recipient} onChange={value => setRecipients(current => current.map(r => r.permitId === recipient.permitId ? { ...value, reviewed: false } : r))} /><label className="mail-check"><input type="checkbox" required checked={recipient.reviewed} onChange={event => setRecipients(current => current.map(r => r.permitId === recipient.permitId ? { ...r, reviewed: event.target.checked } : r))} />I reviewed the recipient, structured delivery address, and original evidence. This is my mailing decision, not source verification.</label></fieldset>; })}
      <button className="button primary" type="submit" disabled={busy || !status?.configured || !recipients.length || approved.length !== selected.length || !front || !back || recipients.some(r => !r.reviewed) || (status?.mode === 'live' && approved.some(p => p.synthetic))}>Save {recipients.length || ''} recipient draft — do not send</button>
      {status?.mode === 'live' && approved.some(p => p.synthetic) && <p className="inline-warning">Synthetic demo records cannot enter a live batch. Configure a test credential.</p>}
    </form>
    <section className="panel mail-section"><div className="mail-section-head"><div><h2>3. Review & submit</h2><p>Saved batches and provider history. Sending is always a separate, deliberate step.</p></div></div>
      {!batches.length ? <div className="quiet-empty">No saved postcard batches yet.</div> : <><label className="mail-batch-picker">Saved batch<select value={activeId} onChange={event => selectBatch(event.target.value)}><option value="">Choose a batch to preview</option>{batches.map(batch => <option key={batch.id} value={batch.id}>{batch.name} · {batch.mode} · {batch.status} · {batch.count} cards</option>)}</select></label><div className="mail-history">{batches.map(batch => <button type="button" key={batch.id} className={`mail-history-row ${activeId === batch.id ? 'active' : ''}`} onClick={() => selectBatch(batch.id)}><strong>{batch.name}</strong><span>{batch.mode} · {batch.status} · {batch.count} cards · {dollars(batch.estimatedTotalCents)} estimated</span></button>)}</div></>}
      {active && <div className="mail-preview"><div className="mail-section-head"><div><h3>{active.name}</h3><p>{active.count} postcards · {active.mode.toUpperCase()} · {active.status} · Estimate {dollars(active.estimatedTotalCents)}</p></div><span className="chip neutral">{active.status}</span></div>
        <p className="mail-help">Batch ID: {active.id} · Created {new Date(active.createdAt).toLocaleString()}</p>
        <div className="mail-art-grid">{['front', 'back'].map(side => <div className="mail-artwork" key={`${active.id}-${side}`}><h4>{side === 'front' ? 'Front' : 'Back'}</h4><img src={`/api/mail/batches/${encodeURIComponent(active.id)}/artwork/${side}`} alt={`Saved ${side} artwork`} onLoad={() => setLoadedArtwork(current => current.includes(side) ? current : [...current, side])} onError={() => { setLoadedArtwork(current => current.filter(value => value !== side)); setError(`Unable to load saved ${side} artwork. Do not submit before reviewing both sides.`); }} /><p>{active[side]?.name} · {active[side]?.width} × {active[side]?.height} px</p></div>)}</div>
        <div className="mail-address-preview"><div><h4>From</h4>{active.sender ? <Address value={active.sender} /> : <p>Sender preview unavailable.</p>}</div><div><h4>To · {active.count} recipients</h4>{active.recipients?.map((r, index) => <div key={r.permitId || index}><Address value={r} /><p className="mail-help">{r.permitId} · {permits.find(p => p.id === r.permitId)?.synthetic ? 'Synthetic demo · test only · ' : ''}{r.reviewed ? 'Address reviewed' : 'Not reviewed'}</p></div>)}</div></div>
        {active.error && <p className="mail-error" role="alert">{active.error}</p>}
        {(active.status === 'uncertain' || active.status === 'submitting') && <div className="mail-caution">Submission outcome may be uncertain. Do not recreate or blindly retry this purchase. Reconcile provider IDs in Lob and use manual status refresh; contact the provider if an ID is missing.</div>}
        {!!active.items?.length && <div className="table-scroll"><table><thead><tr><th>RECIPIENT / ITEM</th><th>PROVIDER ID</th><th>PROVIDER STATUS / ERROR</th></tr></thead><tbody>{active.items.map((item, index) => <tr key={item.id || index}><td>{item.permitId || item.recipient?.name || index + 1}</td><td>{item.providerId || 'No provider ID recorded'}</td><td>{item.providerStatus || item.status || 'Unknown'}{item.error && <p className="mail-error">{item.error}</p>}</td></tr>)}</tbody></table></div>}
        {active.status !== 'draft' && <button className="button" disabled={busy} onClick={() => run(async () => { await request(`batches/${encodeURIComponent(active.id)}/provider`); await refresh(); })}><RefreshCw size={14} />Refresh recorded provider IDs only</button>}
        {active.status === 'draft' && <div className="mail-send"><h3>{active.mode === 'live' ? 'Purchase physical postcards' : 'Submit a test — no live purchase'}</h3><p>Review the saved artwork and every address above. Provider charges may differ from your estimate; taxes, postage and provider pricing may change. Use Lob account controls for spending protection.</p><label>Operator estimate authorization (cents)<input required type="number" min={active.estimatedTotalCents} step="1" value={maxSpend} onChange={event => setMaxSpend(event.target.value)} /></label><p className="mail-help">This checks the stored estimate only. It is not a provider-enforced hard spend cap.</p><label className="mail-check"><input type="checkbox" checked={estimateAck} onChange={event => setEstimateAck(event.target.checked)} />I understand the estimate is not a quote or guaranteed cap, and I am responsible for provider account controls and charges.</label><label className="mail-check"><input type="checkbox" checked={complianceAck} onChange={event => setComplianceAck(event.target.checked)} />I reviewed the artwork, addresses, authorization, applicable marketing/privacy rules, and suppression obligations. Public records alone do not establish permission.</label><label>Type {requiredConfirmation}<input autoComplete="off" value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label><button className={`button ${active.mode === 'live' ? 'mail-live-button' : 'primary'}`} disabled={busy || loadedArtwork.length !== 2 || !status?.configured || status.mode !== active.mode || !estimateAck || !complianceAck || confirmation !== requiredConfirmation || !Number.isInteger(Number(maxSpend)) || Number(maxSpend) < active.estimatedTotalCents || !maxSpend} onClick={() => run(async () => { await request(`batches/${encodeURIComponent(active.id)}/submit`, 'POST', { confirmation, maxSpendCents: Number(maxSpend), acknowledgeEstimate: estimateAck, acknowledgeCompliance: complianceAck }); setConfirmation(''); setEstimateAck(false); setComplianceAck(false); await refresh(); onToast?.({ text: 'Submission recorded. Review the provider result below.' }); })}>{busy ? 'Working…' : active.mode === 'live' ? `Purchase ${active.count} live postcards` : `Send ${active.count} test postcards`}</button>{status?.mode !== active.mode && <p className="inline-warning">Configure a {active.mode} credential before submitting this batch.</p>}</div>}
      </div>}
    </section>
  </div>;
}
