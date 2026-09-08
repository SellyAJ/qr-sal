# Security

Treat every QR payload as untrusted text. Render it with `textContent`, not HTML. Do not automatically open URLs, execute commands or assume issuer identity from a successful decode.

The library performs CPU- and memory-intensive work on untrusted pixels. Use worker/process isolation, input-size limits and external deadlines in services. The browser adapter includes cancellation and a worker watchdog; source image decoding and PDF rendering require their own application-level controls.

For a vulnerability, use the repository’s **Security → Report a vulnerability** flow when available. If it is unavailable, open an issue asking for a private reporting channel without posting the exploit, credentials or private documents. Do not include personal QR payloads in public reports.

Only the latest release is maintained. No claim of an independent security audit is made.
