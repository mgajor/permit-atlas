# Contributing

Contributions are provided under Apache-2.0 as described by section 5 of LICENSE. Submit only material you have rights to contribute. Keep third-party attribution and license notices intact.

Use Node.js 22+, `npm ci`, `npm test`, and `npm run build`. Test desktop behavior on the platform you claim to support; document untested platforms honestly.

Do not submit personal records, scraped owner lists, customer data, credentials, artwork without permission, local databases or real provider identifiers. Fixtures and screenshots must be clearly synthetic. Never use live provider credentials in CI.

Changes to source adapters must preserve raw evidence and source provenance. Missing fields cannot silently become verification. Changes to mail require regression coverage for duplicate submission, uncertain provider outcomes, explicit approval and synthetic/live separation. Network tests must not purchase mail.

The project grants no rights to municipal data, providers, trademarks or uploaded creative assets. Do not add legal/compliance guarantees or claims of conversion rates that are not supported by evidence.
