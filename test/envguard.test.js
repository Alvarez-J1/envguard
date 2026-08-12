const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdir, mkdtemp, rm, writeFile } = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  checkEnvironmentVariables,
  findEnvExamplePath,
  findEnvReferences,
  parseEnvExample
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

    const result = spawnSync(
      process.execPath,
      [
        "--",
        path.join(__dirname, "..", "dist", "cli.js"),
        "--env-file",
        ".env.local.example",
        path.join(fixtureDir, "src")
      ],
      { encoding: "utf8" }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\.env\.local\.example/);
  });
});

test("CLI accepts a separator before --env-file for npm-style shims", async () => {
  await withFixture(async (fixtureDir) => {
    await mkdir(path.join(fixtureDir, "src"));
    await writeFile(path.join(fixtureDir, ".env.local.example"), "API_URL=\n");
    await writeFile(path.join(fixtureDir, "src", "index.ts"), "process.env.API_URL;\n");

    const result = spawnSync(
      process.execPath,
      [
        path.join(__dirname, "..", "dist", "cli.js"),
        "--",
        "--env-file",
        ".env.local.example",
        path.join(fixtureDir, "src")
      ],
      { encoding: "utf8" }
    );

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /\.env\.local\.example/);
  });
});

async function withFixture(callback) {
  const fixtureDir = await mkdtemp(path.join(os.tmpdir(), "envguard-"));

  try {
    await callback(fixtureDir);
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
}
