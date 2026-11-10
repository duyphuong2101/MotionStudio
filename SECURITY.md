# Security Policy

## Supported Versions

Motion Studio is an actively developed local-first tool. Security updates and patches are applied to the latest code on the `main` branch.

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1   | :x:                |

## Security Model

Motion Studio enforces a strict local-first boundary:
- **Localhost only**: The UI server binds strictly to `127.0.0.1` with Host, Origin, and `X-Studio` header verification.
- **No shell execution**: Internal engine processes spawn with `shell: false` and explicit argument arrays.
- **Credential isolation**: API keys reside in environment variables or a gitignored local `.env` file; they are never exposed to the client UI or logged.
- **Sandboxed rendering**: Compositions execute inside an isolated browser context with Content Security Policy (CSP).

## Reporting a Vulnerability

If you discover a security vulnerability in Motion Studio:

1. **Do not disclose it publicly** via GitHub Issues or pull requests.
2. Please report the issue privately by opening a draft advisory under the **Security** tab of this repository.
3. Please provide a brief description of the issue, steps to reproduce, and your environment (OS, Node.js version).

### Response Expectations
- **Initial acknowledgment**: Within 48 hours.
- **Triage & fix**: We will review the issue and release a patch to `main` once verified.
