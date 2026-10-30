# Permit Atlas

A local-first desktop workspace for researching municipal permits, reviewing source evidence, allocating projects exclusively within your workspace, and preparing human-approved direct-mail batches.

Built with Electron, React, Express and SQLite (sql.js). Apache-2.0 licensed. This is software and methodology, **not a published homeowner mailing list or a promise of qualified leads**.

## What it demonstrates

- Source-specific public-data ingestion with pagination and explicit failure states.
- Search, filters, evidence inspection, raw source records and review notes.
- Human review before allocation, cumulative weekly caps and durable project reservations.
- Synthetic demonstration records with missing values, named contractors, duplicate projects and uncertain enrichment.
- CSV and customer HTML exports.
- Opt-in Lob postcard workflow with artwork, explicit recipient review, cost-estimate acknowledgment and separate submission confirmation.

No calls or email outreach. No scheduled/automatic paid mailing. Public records and missing contractor fields do not establish homeowner consent or project availability.

## Run locally

Node.js 22+ and npm:

```sh
npm ci
npm test
npm run build
npm run serve
```

Open http://127.0.0.1:4318. For the desktop shell:

```sh
npm run desktop
```

Fresh workspaces load **fictional, nonmailable synthetic examples only**. Source refresh is manual. Existing local workspaces are not erased or replaced by an upgrade. Use `PERMIT_ATLAS_DATA_DIR` with `npm run serve` for a separate clean demonstration workspace.

## Sources and enrichment

Chicago, Seattle and Mesa have manual Socrata connectors. Source data remains subject to its own terms, publication delays and schema changes. Phoenix is represented in synthetic examples; this release has no Phoenix live connector.

Owner/address matches are evidence candidates, not verified identities. The earlier research scripts and personal datasets are intentionally excluded. The public release does not automatically enrich owners from assessor records. See [PROCESS.md](PROCESS.md) for normalization, classification, allocations and limitations.

## Direct mail: bring your own Lob account

1. Open Direct mail. Test mode is the default.
2. Supply your own Lob secret **test key**. Desktop credentials use Electron OS-protected encryption; browser mode keeps credentials in memory for the process lifetime. Keys are never returned through the API.
3. Approve selected permits in the explorer. Create a draft with front/back 4×6 postcard artwork (PNG/JPEG), sender and explicitly reviewed structured recipient addresses.
4. Inspect the batch, acknowledge estimate limitations and compliance responsibility, and type the test submission confirmation.
5. Submit deliberately. Test mode calls Lob's test environment through its API; it does not purchase physical mail. A provider account/key is required even for this real provider test.

Live submission additionally requires launching with `PERMIT_ATLAS_ALLOW_LIVE_MAIL=1`, a live secret key and the live purchase confirmation. Synthetic records must never be submitted in live mode. **The app's per-piece amount is an operator-entered estimate, not a provider quote or guaranteed spending cap.** Configure billing controls in the provider account; review current Lob pricing. Address verification and test submissions can have provider-account implications.

Durable outbox state and per-item idempotency reduce duplicate submissions. A timeout can leave an uncertain result: do not blindly resend it. Provider IDs permit manual status refresh. Submission is not delivery, and cancellation is not guaranteed. See [Lob's official API documentation](https://docs.lob.com/) for provider requirements and artwork specifications.

## Packaging and platform status

```sh
npm run build
npm run pack  # unpacked application on the current platform
npm run dist  # configured installer targets on the current platform
```

Targets: macOS DMG/ZIP, Windows NSIS, Linux AppImage. Local macOS packaging/application was exercised during development; Windows/Linux user-interface verification remains pending. The GitHub Actions matrix builds/tests each platform; a green build is not a claim of manual platform testing.

macOS builds are explicitly unsigned by default and are **not notarized**. We do not discover or consume a local developer signing identity automatically. Public signed/notarized distribution requires a separately configured release process and your own Apple credentials. The build workflow neither signs nor publishes release installers.

## Safety and privacy

This is a **single-user loopback application**, not a publicly hosted service. No application authentication, multi-tenant isolation or encrypted workspace database is provided. Do not expose it through a public tunnel. The local user is trusted. Review [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md).

No provider credentials, real owner datasets, local databases, artwork uploads, research pitches or generated customer exports belong in Git. The repository allowlist and packaging allowlist enforce separate boundaries.

## License and third parties

[Apache License 2.0](LICENSE), with attribution in [NOTICE](NOTICE). Commercial use and proprietary derivatives are permitted subject to the license. Third-party dependencies retain their own terms; municipal data, provider services, trademarks and uploaded artwork are not licensed by this repository. No municipality or mail provider endorses this project.

Provided as-is, without a promise of legal compliance, lead quality, energy savings, revenue, delivery or business outcomes. Consult qualified counsel about the actual jurisdictions, data use and outreach involved. See [CONTRIBUTING.md](CONTRIBUTING.md) before contributing.
