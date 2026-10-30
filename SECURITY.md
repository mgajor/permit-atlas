# Security

## Supported boundary

Permit Atlas is a single-user local application. Express binds loopback, validates local Host/Origin, bounds requests, escapes CSV/HTML exports and requires human review before allocation. Electron renderer Node access is disabled and context isolation/sandbox enabled. These controls do not make it a safe multi-user web service. Local users and processes with account/filesystem access are trusted.

Do not expose the port publicly. Do not put provider keys into frontend code, Git, screenshots, issue reports or exported files. Mail is opt-in and may incur costs; spending estimates are not provider-enforced limits. Test uncertain submissions and recovery behavior before enabling live mail.

## Reporting

Report vulnerabilities privately using GitHub's private vulnerability reporting feature if enabled, or contact the repository owner privately. Do not post real keys or homeowner records in an issue. If a credential was disclosed, revoke/rotate it at the provider; deleting the file or commit does not revoke it. No response-time or support SLA is promised.

## Release scope

Default macOS packages are unsigned and not notarized. Platform build success does not certify security or functional parity. Review dependency notices and audit results before distribution. Cross-platform manual testing is documented separately from CI builds.
