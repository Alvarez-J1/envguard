# envguard

Small npm CLI that checks whether environment variables referenced in source code
are documented in `.env.example`.

## Usage

```sh
npx @alvarez-j2/envguard
npx @alvarez-j2/envguard ./src
npx @alvarez-j2/envguard --example-file .env.local.example ./src
```

`envguard` recursively scans JavaScript and TypeScript files for
`process.env.VARIABLE_NAME`, reads variable names from an example env file, and
exits with status code `1` when referenced variables are missing from that file.
When a directory argument is provided, `envguard` scans that directory and looks
for the nearest `.env.example` starting from that directory and walking upward.
Use `--env-file <name>` to check a different file name, such as
`.env.local.example`. EnvGuard also supports `--example-file <name>`, which is
recommended when running through `npx` on modern Node versions.

## Supported Syntax

EnvGuard detects direct dot notation such as `process.env.API_URL`. Dynamic
access such as `process.env["API_URL"]` is intentionally out of scope.

`--env-file` is also a Node.js runtime flag in modern Node versions. When using
`npx` or an npm-generated shim, use `--example-file` to avoid that collision, or
place `--` before EnvGuard's `--env-file` flag.
When running the compiled CLI directly with Node, use:

```sh
node -- ./dist/cli.js --env-file .env.local.example ./src
```

## Testing a Published Version Locally

If you run `npx @alvarez-j2/envguard@<version>` from inside this package's own
source directory, npm may resolve the current folder as the requested package.
On Windows that can fail before EnvGuard starts because the root package does
not have a generated `node_modules/.bin/envguard.cmd` shim.

Run the published package from another directory, or pass npm a different
execution prefix:

```sh
npx --yes --prefix C:\Users\Owner\projects @alvarez-j2/envguard@0.1.2 --example-file .env.local.example C:\Users\Owner\projects\Elevate
```

The scanner ignores `node_modules`, `.git`, `dist`, `build`, and `.next`.

## Scanned Files

EnvGuard scans `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, `.mts`, and `.cts`
files. TypeScript declaration files ending in `.d.ts` are skipped.

## Exit Codes

- `0` when every referenced variable is declared in the example env file.
- `1` when variables are missing or EnvGuard cannot complete the scan.

## Development

```sh
npm install
npm test
```

The implementation is intentionally small:

- `src/envguard.ts` contains scanning, `.env.example` parsing, and comparison logic.
- `src/cli.ts` handles arguments, printing, and exit codes.
- `test/envguard.test.js` tests the real compiled package output.
