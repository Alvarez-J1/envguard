# envguard

Small npm CLI that checks whether environment variables referenced in source code
are documented in `.env.example`.

## Usage

```sh
npx envguard
npx envguard ./src
npx envguard -- --env-file .env.local.example ./src
```

`envguard` recursively scans JavaScript and TypeScript files for
`process.env.VARIABLE_NAME`, reads variable names from an example env file, and
exits with status code `1` when referenced variables are missing from that file.
When a directory argument is provided, `envguard` scans that directory and looks
for the nearest `.env.example` starting from that directory and walking upward.
Use `--env-file <name>` to check a different file name, such as
`.env.local.example`.

`--env-file` is also a Node.js runtime flag in modern Node versions. When using
`npx` or an npm-generated shim, place `--` before EnvGuard's flag as shown above.
When running the compiled CLI directly with Node, use:

```sh
node -- ./dist/cli.js --env-file .env.local.example ./src
```

The scanner ignores `node_modules`, `.git`, `dist`, `build`, and `.next`.

## Development

```sh
npm install
npm test
```

The implementation is intentionally small:

- `src/envguard.ts` contains scanning, `.env.example` parsing, and comparison logic.
- `src/cli.ts` handles arguments, printing, and exit codes.
- `test/envguard.test.js` tests the real compiled package output.

The detector focuses on direct dot notation, like `process.env.API_URL`. Dynamic
access such as `process.env["API_URL"]` is intentionally out of scope.
