const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdir, mkdtemp, readFile, rm, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const packageJson = require("../package.json");
const CLI_PATH = path.join(__dirname, "..", "dist", "cli.js");

const {
  checkEnvironmentVariables,
  findEnvExamplePath,
  findEnvReferences,
  parseEnvExample,
  scanDirectory
} = require("../dist/envguard.js");

test("findEnvReferences detects process.env dot references", () => {
  const source = `
    const url = process.env.API_URL;
    const token = process.env.SECRET_TOKEN;
    const repeated = process.env.API_URL;
    const ignored = process.env["DYNAMIC_NAME"];
  `;

  assert.deepEqual([...findEnvReferences(source)].sort(), [
    "API_URL",
    "SECRET_TOKEN"
  ]);
});

test("findEnvReferences tolerates whitespace around dots", () => {
  const source = "const value = process . env . SPACED_ENV_NAME;\n";

  assert.deepEqual([...findEnvReferences(source)], ["SPACED_ENV_NAME"]);
});

test("findEnvReferences ignores identifiers that start with digits", () => {
  const source = `
    process.env.1INVALID;
    process.env.VALID_NAME;
  `;

  assert.deepEqual([...findEnvReferences(source)], ["VALID_NAME"]);
});

test("parseEnvExample reads declared variables", () => {
  const source = `
    # Example configuration
    API_URL=https://example.com
    export SECRET_TOKEN=
    INVALID LINE
  `;

  assert.deepEqual([...parseEnvExample(source)].sort(), [
    "API_URL",
    "SECRET_TOKEN"
  ]);
});

test("parseEnvExample allows whitespace around assignments", () => {
  const source = `
      API_URL = https://example.com
      export SECRET_TOKEN =
  `;

  assert.deepEqual([...parseEnvExample(source)].sort(), [
    "API_URL",
    "SECRET_TOKEN"
  ]);
});

test("parseEnvExample supports underscores and digits after the first character", () => {
  const source = `
    API_V2_URL=
    _INTERNAL_TOKEN=
  `;

  assert.deepEqual([...parseEnvExample(source)].sort(), [
    "API_V2_URL",
    "_INTERNAL_TOKEN"
  ]);
});

test("parseEnvExample ignores invalid variable names", () => {
  const source = `
    1INVALID=
    HAS-DASH=
    VALID_NAME=
  `;

  assert.deepEqual([...parseEnvExample(source)], ["VALID_NAME"]);
});

test("parseEnvExample returns each variable once", () => {
  const source = `
    API_URL=
    API_URL=https://example.com
  `;

  assert.deepEqual([...parseEnvExample(source)], ["API_URL"]);
});

test("checkEnvironmentVariables reports variables missing from .env.example", async () => {
  await withFixture(async (fixtureDir) => {
    await mkdir(path.join(fixtureDir, "src"));
    await mkdir(path.join(fixtureDir, "node_modules", "package"), { recursive: true });
    await mkdir(path.join(fixtureDir, ".next"), { recursive: true });
    await writeFile(path.join(fixtureDir, ".env.example"), "API_URL=\n");
    await writeFile(
      path.join(fixtureDir, "src", "index.ts"),
      "process.env.API_URL; process.env.SECRET_TOKEN;\n"
    );
    await writeFile(
      path.join(fixtureDir, "node_modules", "package", "ignored.js"),
      "process.env.IGNORED_NODE_MODULES;\n"
    );
    await writeFile(
      path.join(fixtureDir, ".next", "ignored.js"),
      "process.env.IGNORED_NEXT;\n"
    );

    const result = await checkEnvironmentVariables(
      fixtureDir,
      path.join(fixtureDir, ".env.example")
    );

    assert.deepEqual(result.referencedVariables, [
      "API_URL",
      "SECRET_TOKEN"
    ]);
    assert.deepEqual(result.definedVariables, ["API_URL"]);
    assert.deepEqual(result.missingVariables, ["SECRET_TOKEN"]);
    assert.equal(result.filesScanned, 1);
  });
});

test("checkEnvironmentVariables throws a helpful error when .env.example is missing", async () => {
  await withFixture(async (fixtureDir) => {
    await assert.rejects(
      () => checkEnvironmentVariables(fixtureDir, path.join(fixtureDir, ".env.example")),
      /Could not find \.env\.example/
    );
  });
});

test("scanDirectory rejects file paths", async () => {
  await withFixture(async (fixtureDir) => {
    const filePath = path.join(fixtureDir, "index.ts");

    await writeFile(filePath, "process.env.API_URL;\n");

    await assert.rejects(
      () => scanDirectory(filePath),
      /Scan target is not a directory/
    );
  });
});

test("scan ignores TypeScript declaration files", async () => {
  await withFixture(async (fixtureDir) => {
    await writeFile(path.join(fixtureDir, ".env.example"), "");
    await writeFile(path.join(fixtureDir, "types.d.ts"), "process.env.DECLARATION_ONLY;\n");

    const result = await checkEnvironmentVariables(
      fixtureDir,
      path.join(fixtureDir, ".env.example")
    );

    assert.deepEqual(result.referencedVariables, []);
    assert.equal(result.filesScanned, 0);
  });
});

test("scan skips build output and git metadata directories", async () => {
  await withFixture(async (fixtureDir) => {
    await mkdir(path.join(fixtureDir, ".git"), { recursive: true });
    await mkdir(path.join(fixtureDir, "build"), { recursive: true });
    await mkdir(path.join(fixtureDir, "dist"), { recursive: true });
    await writeFile(path.join(fixtureDir, ".env.example"), "");
    await writeFile(path.join(fixtureDir, ".git", "ignored.js"), "process.env.GIT_VAR;\n");
    await writeFile(path.join(fixtureDir, "build", "ignored.js"), "process.env.BUILD_VAR;\n");
    await writeFile(path.join(fixtureDir, "dist", "ignored.js"), "process.env.DIST_VAR;\n");

    const result = await checkEnvironmentVariables(
      fixtureDir,
      path.join(fixtureDir, ".env.example")
    );

    assert.deepEqual(result.referencedVariables, []);
    assert.equal(result.filesScanned, 0);
  });
});

test("scan skips ignored directories at any depth", async () => {
  await withFixture(async (fixtureDir) => {
    const packageDir = path.join(fixtureDir, "packages", "app");

    await mkdir(path.join(packageDir, "src"), { recursive: true });
    await mkdir(path.join(packageDir, "src", "node_modules"), { recursive: true });
    await mkdir(path.join(packageDir, "src", ".next"), { recursive: true });
    await writeFile(path.join(fixtureDir, ".env.example"), "");
    await writeFile(path.join(packageDir, "src", "index.ts"), "process.env.APP_VAR;\n");
    await writeFile(
      path.join(packageDir, "src", "node_modules", "ignored.js"),
      "process.env.NESTED_NODE_MODULES;\n"
    );
    await writeFile(
      path.join(packageDir, "src", ".next", "ignored.js"),
      "process.env.NESTED_NEXT;\n"
    );

    const result = await checkEnvironmentVariables(
      fixtureDir,
      path.join(fixtureDir, ".env.example")
    );

    assert.deepEqual(result.referencedVariables, ["APP_VAR"]);
    assert.equal(result.filesScanned, 1);
  });
});

test("scan includes modern JavaScript and TypeScript module extensions", async () => {
  await withFixture(async (fixtureDir) => {
    await writeFile(path.join(fixtureDir, ".env.example"), "");
    await writeFile(path.join(fixtureDir, "config.mjs"), "process.env.MJS_VAR;\n");
    await writeFile(path.join(fixtureDir, "config.cjs"), "process.env.CJS_VAR;\n");
    await writeFile(path.join(fixtureDir, "config.mts"), "process.env.MTS_VAR;\n");
    await writeFile(path.join(fixtureDir, "config.cts"), "process.env.CTS_VAR;\n");

    const result = await checkEnvironmentVariables(
      fixtureDir,
      path.join(fixtureDir, ".env.example")
    );

    assert.deepEqual(result.referencedVariables, [
      "CJS_VAR",
      "CTS_VAR",
      "MJS_VAR",
      "MTS_VAR"
    ]);
    assert.equal(result.filesScanned, 4);
  });
});

test("scan includes JSX and TSX source files", async () => {
  await withFixture(async (fixtureDir) => {
    await writeFile(path.join(fixtureDir, ".env.example"), "");
    await writeFile(path.join(fixtureDir, "Component.jsx"), "process.env.JSX_VAR;\n");
    await writeFile(path.join(fixtureDir, "Component.tsx"), "process.env.TSX_VAR;\n");

    const result = await checkEnvironmentVariables(
      fixtureDir,
      path.join(fixtureDir, ".env.example")
    );

    assert.deepEqual(result.referencedVariables, [
      "JSX_VAR",
      "TSX_VAR"
    ]);
    assert.equal(result.filesScanned, 2);
  });
});

test("scan ignores files without source extensions", async () => {
  await withFixture(async (fixtureDir) => {
    await writeFile(path.join(fixtureDir, ".env.example"), "");
    await writeFile(path.join(fixtureDir, "config.json"), "{\"value\":\"process.env.JSON_VAR\"}\n");
    await writeFile(path.join(fixtureDir, "README.md"), "process.env.DOCS_VAR\n");

    const result = await checkEnvironmentVariables(
      fixtureDir,
      path.join(fixtureDir, ".env.example")
    );

    assert.deepEqual(result.referencedVariables, []);
    assert.equal(result.filesScanned, 0);
  });
});

test("findEnvExamplePath finds .env.example above the scanned directory", async () => {
  await withFixture(async (fixtureDir) => {
    const srcDir = path.join(fixtureDir, "src");

    await mkdir(srcDir);
    await writeFile(path.join(fixtureDir, ".env.example"), "API_URL=\n");

    assert.equal(await findEnvExamplePath(srcDir), path.join(fixtureDir, ".env.example"));
  });
});

test("findEnvExamplePath supports a custom env file name", async () => {
  await withFixture(async (fixtureDir) => {
    await writeFile(path.join(fixtureDir, ".env.local.example"), "API_URL=\n");

    assert.equal(
      await findEnvExamplePath(fixtureDir, ".env.local.example"),
      path.join(fixtureDir, ".env.local.example")
    );
  });
});

test("findEnvExamplePath rejects env file names with path separators", async () => {
  await assert.rejects(
    () => findEnvExamplePath(".", "config/.env.example"),
    /Env file must be a file name, not a path/
  );
});

test("findEnvExamplePath rejects absolute env file names", async () => {
  await assert.rejects(
    () => findEnvExamplePath(".", path.resolve(".env.example")),
    /Env file must be a file name, not a path/
  );
});

test("findEnvExamplePath ignores directories with the env example name", async () => {
  await withFixture(async (fixtureDir) => {
    await mkdir(path.join(fixtureDir, ".env.example"));

    await assert.rejects(
      () => findEnvExamplePath(fixtureDir),
      /Could not find \.env\.example/
    );
  });
});

test("findEnvExamplePath mentions similarly named example files", async () => {
  await withFixture(async (fixtureDir) => {
    await writeFile(path.join(fixtureDir, ".env.local.example"), "API_URL=\n");

    await assert.rejects(
      () => findEnvExamplePath(fixtureDir),
      /\.env\.local\.example.*expects the file to be named \.env\.example/
    );
  });
});

test("CLI supports --env-file for custom example env files", async () => {
  await withFixture(async (fixtureDir) => {
    await mkdir(path.join(fixtureDir, "src"));
    await writeFile(path.join(fixtureDir, ".env.local.example"), "API_URL=\n");
    await writeFile(path.join(fixtureDir, "src", "index.ts"), "process.env.API_URL;\n");

    const result = runCli(
      [
        "--env-file",
        ".env.local.example",
        path.join(fixtureDir, "src")
      ],
      ["--"]
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\.env\.local\.example/);
  });
});

test("CLI succeeds when no environment variables are referenced", async () => {
  await withFixture(async (fixtureDir) => {
    await writeFile(path.join(fixtureDir, ".env.example"), "");
    await writeFile(path.join(fixtureDir, "index.ts"), "export const value = 1;\n");

    const result = runCli([fixtureDir]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /all 0 referenced environment variable/);
  });
});

test("CLI scans the current directory by default", async () => {
  await withFixture(async (fixtureDir) => {
    await writeFile(path.join(fixtureDir, ".env.example"), "API_URL=\n");
    await writeFile(path.join(fixtureDir, "index.ts"), "process.env.API_URL;\n");

    const result = runCli([], [], { cwd: fixtureDir });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /all 1 referenced environment variable/);
  });
});

test("CLI finds the example env file above the scanned directory", async () => {
  await withFixture(async (fixtureDir) => {
    const srcDir = path.join(fixtureDir, "src");

    await mkdir(srcDir);
    await writeFile(path.join(fixtureDir, ".env.example"), "API_URL=\n");
    await writeFile(path.join(srcDir, "index.ts"), "process.env.API_URL;\n");

    const result = runCli([srcDir]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /all 1 referenced environment variable/);
  });
});

test("CLI reports missing variables with a failure exit code", async () => {
  await withFixture(async (fixtureDir) => {
    await writeFile(path.join(fixtureDir, ".env.example"), "");
    await writeFile(path.join(fixtureDir, "index.ts"), "process.env.MISSING_API_KEY;\n");

    const result = runCli([fixtureDir]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /missing variables in \.env\.example/);
    assert.match(result.stderr, /MISSING_API_KEY/);
  });
});

test("CLI prints help successfully", () => {
  const result = runCli(["--help"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: envguard/);
  assert.match(result.stdout, /--example-file/);
});

test("CLI supports the short help flag", () => {
  const result = runCli(["-h"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: envguard/);
});

test("CLI rejects unknown options", () => {
  const result = runCli(["--unknown"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown option: --unknown/);
});

test("CLI rejects env file options without a value", () => {
  const result = runCli(["--example-file"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /--example-file requires a file name/);
});

test("CLI rejects empty env file assignment values", () => {
  const result = runCli(["--example-file="]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Env file option requires a file name/);
});

test("CLI rejects env file names that include paths", async () => {
  await withFixture(async (fixtureDir) => {
    const result = runCli([
      "--example-file",
      "config/.env.example",
      fixtureDir
    ]);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Env file must be a file name, not a path/);
  });
});

test("CLI rejects multiple directory arguments", () => {
  const result = runCli(["src", "test"]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /expected at most one directory argument/);
});

test("CLI supports --example-file without a Node separator", async () => {
  await withFixture(async (fixtureDir) => {
    await mkdir(path.join(fixtureDir, "src"));
    await writeFile(path.join(fixtureDir, ".env.local.example"), "API_URL=\n");
    await writeFile(path.join(fixtureDir, "src", "index.ts"), "process.env.API_URL;\n");

    const result = runCli([
      "--example-file",
      ".env.local.example",
      path.join(fixtureDir, "src")
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\.env\.local\.example/);
  });
});

test("CLI supports --example-file=value syntax", async () => {
  await withFixture(async (fixtureDir) => {
    await mkdir(path.join(fixtureDir, "src"));
    await writeFile(path.join(fixtureDir, ".env.local.example"), "API_URL=\n");
    await writeFile(path.join(fixtureDir, "src", "index.ts"), "process.env.API_URL;\n");

    const result = runCli([
      "--example-file=.env.local.example",
      path.join(fixtureDir, "src")
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\.env\.local\.example/);
  });
});

test("CLI accepts a separator before --env-file=value syntax", async () => {
  await withFixture(async (fixtureDir) => {
    await mkdir(path.join(fixtureDir, "src"));
    await writeFile(path.join(fixtureDir, ".env.local.example"), "API_URL=\n");
    await writeFile(path.join(fixtureDir, "src", "index.ts"), "process.env.API_URL;\n");

    const result = runCli([
      "--",
      "--env-file=.env.local.example",
      path.join(fixtureDir, "src")
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\.env\.local\.example/);
  });
});

test("CLI accepts a separator before --env-file for npm-style shims", async () => {
  await withFixture(async (fixtureDir) => {
    await mkdir(path.join(fixtureDir, "src"));
    await writeFile(path.join(fixtureDir, ".env.local.example"), "API_URL=\n");
    await writeFile(path.join(fixtureDir, "src", "index.ts"), "process.env.API_URL;\n");

    const result = runCli([
      "--",
      "--env-file",
      ".env.local.example",
      path.join(fixtureDir, "src")
    ]);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\.env\.local\.example/);
  });
});

test("package exposes an executable envguard bin", async () => {
  assert.equal(packageJson.bin.envguard, "dist/cli.js");

  const cliSource = await readFile(
    path.join(__dirname, "..", packageJson.bin.envguard),
    "utf8"
  );

  assert.match(cliSource, /^#!\/usr\/bin\/env node/);
});

async function withFixture(callback) {
  const fixtureDir = await mkdtemp(path.join(os.tmpdir(), "envguard-"));

  try {
    await callback(fixtureDir);
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
}

function runCli(args, nodeArgs = [], options = {}) {
  return spawnSync(process.execPath, [...nodeArgs, CLI_PATH, ...args], {
    cwd: options.cwd,
    encoding: "utf8"
  });
}
