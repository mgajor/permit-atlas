# Privacy and data handling

Fresh installations bundle fictional demonstration records, not homeowner datasets. Existing user workspaces remain local and are not overwritten by upgrade. Refreshing a source downloads real municipal records only after the operator requests it. Records may include personal information and publication does not grant blanket permission to redistribute or market to people.

The workspace database, exports, uploaded mail artwork, outbox and credentials must stay outside Git. Electron stores provider secrets with OS-backed encryption where supported and refuses insecure basic-text fallback. Browser-server credentials are session-only. The workspace database and mail outbox themselves are not encrypted; anyone with local filesystem access may read them. Clearing credentials does not remove prior batches or provider-side records.

No telemetry is intentionally included. Normal data refresh contacts official source endpoints. Mail operations contact Lob: submitting recipient details, sender details and artwork discloses them to that provider under its terms/privacy policy. Test-mode submissions also disclose the supplied information; use synthetic recipient details for testing. External source/provider links open a browser.

Review recipient identity, address, unit, entity ownership, suppression requests and applicable requirements before submitting. Correct delivery formatting is not proof of consent or suitability for marketing. Do not infer sensitive personal circumstances or represent public-record information as a private inspection.

The operator controls retention and backups. To remove local workspace files, stop the application first and delete its data directory; this does not cancel mail or delete remote provider data. There is no claim of zero liability or guaranteed regulatory compliance.
