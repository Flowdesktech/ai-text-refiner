# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security vulnerabilities.

Instead, use [GitHub's private vulnerability reporting](https://github.com/your-username/ai-text-refiner/security/advisories/new)
or email the maintainer directly. We aim to acknowledge reports within 72 hours.

When reporting, please include:

- A description of the issue and its potential impact
- Steps to reproduce
- Affected version(s) and platform(s)

## How your data is handled

AI Text Refiner is a local-first desktop app:

- **API keys** are encrypted at rest using Electron `safeStorage` (your OS keychain). If no OS
  keychain is available, keys fall back to base64 encoding and the app warns you.
- **Your text** is sent only to the LLM provider you configure, using your own API key. The app
  has no backend servers of its own.
- The original **clipboard** contents are restored after each run (when enabled).

## Supported versions

As a pre-1.0 project, security fixes are applied to the latest release.
