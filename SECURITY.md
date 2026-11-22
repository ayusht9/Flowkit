# Security policy

## Reporting a vulnerability

Please **don't open a public issue** for security problems. Report them privately through GitHub: go to the repository's **Security** tab and choose **[Report a vulnerability](https://github.com/ayusht9/Flowkit/security/advisories/new)**.

Include the FlowKit version (`flowkit-mcp --doctor`), the tool and arguments involved, and the smallest file or steps that reproduce the issue. You should get a first response within 7 days. Once a fix is released, the advisory will credit you unless you prefer otherwise.

## Supported versions

Security fixes go into the latest published `flowkit-mcp` release. Please upgrade before reporting: `npm install --global flowkit-mcp@latest`.

## What FlowKit protects against

FlowKit runs trusted native engines (Pandoc, qpdf, Ghostscript, ImageMagick, FFmpeg) on files an AI agent chooses. It is designed so that:

- Paths are resolved inside the configured workspace. Absolute paths, `..` escapes, and symlinks pointing outside the workspace are rejected.
- Tool arguments are schema-validated with explicit bounds, and unknown arguments are rejected.
- Native engines run without a shell, with fixed arguments, timeouts, size limits, and temporary directories.
- Source files are never overwritten. Results are written to new files under `.flowkit-artifacts/`.
- Passwords are read from files in the workspace and are never accepted as tool arguments or returned in results.

`npm run benchmark` re-checks these boundaries on every run (see "Safety boundary checks" in [docs/BENCHMARKS.md](docs/BENCHMARKS.md)).

## Out of scope

- Vulnerabilities in the native engines themselves. Report those upstream and keep your engines up to date.
- Processing untrusted files in a workspace that also contains sensitive data. FlowKit doesn't yet isolate engines in a container or sandbox, so point `--workspace` at a folder that holds only the files you want processed.
- The hosted demo of the workflow studio, which has no accounts and is not meant for confidential files.
