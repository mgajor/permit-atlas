# Permit Atlas — methodology and operating safeguards

## Architecture and data flow

Electron launches an Express server on a random loopback port and displays the compiled React UI in a sandboxed renderer. Browser mode uses server/cli.cjs (default port 4318). SQLite via sql.js persists the local workspace using atomic file replacement. Run one server process per data directory. This is not a hosted multi-tenant CRM.

Data flow: **synthetic examples or explicit source refresh → normalization → evidence inspection → human review → scoped exclusive allocation → optional reviewed mail batch**.

The public package includes only samples/fixtures.json. Older CSVs, enrichment lists, research pitches and prototype scripts are private research artifacts, not production dependencies. Existing workspaces are not wiped on upgrade. For a clean portfolio demo, choose a new PERMIT_ATLAS_DATA_DIR in browser mode.

## Source ingestion

Manual refresh supports Chicago, Seattle and Mesa. Each uses its official Socrata dataset, date bounds for 7/30/90 calendar dates including today, stable-order pagination, 1,000-row pages, per-request timeouts and a 10,000-record completeness guard. Failures are recorded without partial permit updates. Source results may be delayed or incomplete; a successful query is not independent proof of freshness. No scheduled scraping or anonymous outreach is enabled.

Phoenix examples are synthetic only in the public release; no live Phoenix refresh is implemented. Portal-family similarity does not guarantee that a single adapter works unchanged across municipalities. Source terms and schema must be verified for each deployment.

## Normalization and evidence

Records have source-qualified IDs, dates, addresses, raw source records, description-based trade tags, valuation types and provenance. Trade tagging is a heuristic, not an expert scope assessment. Mixed projects can need manual recategorization. Zero and missing valuations are displayed as unavailable; a source-reported value is not a sales quote, profit forecast, budget floor or a justification for a universal invoice multiplier.

A missing contractor is UNKNOWN. OWNER contact type, approved review, or permit status OPEN is not proof that a job is available. All available raw source evidence remains inspectable.

Enrichment must distinguish exact APN match, exact/normalized address match, approximate/prefix match, ambiguous candidates and rejected matches. Record candidate count, source, timestamp, unit agreement and reviewer decision. An assessor owner can be a trust, association or park owner rather than the person ordering work. First-match results are not verified identities. This release preserves candidates and synthetic examples but does not implement automatic live assessor enrichment.

## Review and allocation

Records begin pending. Approval is an operator decision for internal use, not homeowner consent, identity verification or legal authorization for advertising. Material source changes reset review to pending. Existing allocations remain reserved.

Allocate explicitly to customers scoped by source/trade with cumulative Monday-UTC weekly caps. Atomic transactions reject a request in full on conflict. Permit IDs are unique; normalized source/address project keys prevent related permits at the same recorded address from being resold within the workspace. Case, punctuation and whitespace normalization cannot reliably detect all unit, alias or cross-jurisdiction duplicates. It also conservatively prevents separate future jobs at the same normalized address from being reassigned. Review those limits before making contractual exclusivity promises.

CSV exports mitigate spreadsheet formula injection; HTML digests escape record content. Downloads are not outreach. Repository exclusivity does not imply monopoly access to public records.

## Physical-mail boundary

The Lob postcard workflow is separate from allocation. The operator selects approved records, uploads PNG/JPEG artwork, enters sender and structured recipient details, explicitly reviews the recipient matches, inspects a draft and confirms submission. No phone or email outreach exists.

Test keys are the default. Test requests contact Lob but do not mail physical pieces. Live requires explicit enablement, live credentials and purchase confirmation. Synthetic records cannot be sent live. No credentials are bundled. Electron uses OS-protected encrypted credential storage and refuses basic-text fallback; browser mode is session-only. Keys never belong in renderer persistence, exports, logs or Git.

Unit costs displayed by the application are **operator-entered estimates, not provider quotes or enforceable billing ceilings**. Provider account limits and current pricing govern charges. Confirm artwork against provider specifications. A local preview is not a provider print proof. Submission responses are not delivery confirmations. Store provider IDs and review provider status; cancellation is not guaranteed.

The durable outbox records submission intent before contacting the provider and uses per-piece idempotency. Timeouts or interruptions can leave uncertain outcomes. Do not blindly create replacement batches; reconcile existing provider IDs/account activity first. Failed and partial submissions must remain visible.

## Privacy and compliance

Public access does not remove privacy, licensing or marketing obligations. Test data disclosed to a provider is still a disclosure; use synthetic recipients in test mode. Keep suppressions, verify decision-maker/recipient suitability and follow local rules and provider terms. This software and its Apache license do not guarantee compliance or eliminate liability. Seek qualified legal advice for commercial operations. See PRIVACY.md and SECURITY.md.

## Portfolio demonstration and platform claims

Demonstrate synthetic records, provenance, ambiguity, review gating, conflict rejection, capacity and export. Show mail configuration/draft review without buying mail. No fabricated live performance or conversion claims. Any provider tests using a simulated transport must be described as simulated, not real Lob acceptance or delivery.

macOS was built/exercised during development. Windows/Linux targets are configured with CI build jobs but manual usability testing is pending. Default artifacts are explicitly unsigned and macOS is not notarized. CI packaging is not certification, signing, notarization or proof of all-platform functionality.

## Licensing and distribution

Application software is Apache-2.0. Keep LICENSE/NOTICE and dependency notices. Municipal data, Lob services, uploaded artwork and trademarks have separate rights and terms. A package/Git allowlist excludes local real data and research artifacts. Publication audit must inspect the exact tracked-file list before the first commit; removal from the working directory later would not erase published Git history.
