#!/usr/bin/env node
import path from "node:path";
import {
  checkEnvironmentVariables,
  DEFAULT_ENV_FILE_NAME,
  findEnvExamplePath
} from "./envguard";

type CliOptions = {
  envFileName: string;
  help: boolean;
  targetDirArg?: string;
};

const USAGE = `Usage: envguard [options] [directory]

Checks JavaScript and TypeScript files for process.env.NAME references and
verifies that each NAME exists in an example env file.

Options:
  --env-file <name>  Example env file name to check (default: .env.example)
  -h, --help         Show this help message

Examples:
  envguard
  envguard ./src
  envguard -- --env-file .env.local.example ./src`;

async function main(args: string[]): Promise<number> {
  const options = parseArgs(args);

  if (options.help) {
    console.log(USAGE);
    return 0;
  }

  const targetDir = path.resolve(process.cwd(), options.targetDirArg ?? ".");
  const envExamplePath = await findEnvExamplePath(targetDir, options.envFileName);
  const result = await checkEnvironmentVariables(targetDir, envExamplePath);

  if (result.missingVariables.length > 0) {
    console.error(`envguard: missing variables in ${options.envFileName}`);
    console.error("");

    for (const variable of result.missingVariables) {
      console.error(`  ${variable}`);
    }

    console.error("");
    console.error(`Scanned ${result.filesScanned} source file(s).`);
    return 1;
  }

  console.log(
    `envguard: all ${result.referencedVariables.length} referenced environment variable(s) are declared in ${options.envFileName}`
  );
  console.log(`Scanned ${result.filesScanned} source file(s).`);
  return 0;
}

function parseArgs(args: string[]): CliOptions {
  const positionalArgs: string[] = [];
  let envFileName = DEFAULT_ENV_FILE_NAME;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--help" || arg === "-h") {
      return { envFileName, help: true };
    }

    if (arg === "--") {
      continue;
    }

    if (arg === "--env-file") {
      const value = args[index + 1];

      if (value === undefined || value.startsWith("-")) {
        throw new Error("--env-file requires a file name");
      }

      envFileName = parseEnvFileName(value);
      index += 1;
      continue;
    }

    if (arg.startsWith("--env-file=")) {
      envFileName = parseEnvFileName(arg.slice("--env-file=".length));
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    positionalArgs.push(arg);
  }

  if (positionalArgs.length > 1) {
    throw new Error("expected at most one directory argument");
  }

  return {
    envFileName,
    help: false,
    targetDirArg: positionalArgs[0]
  };
}

function parseEnvFileName(value: string): string {
  const envFileName = value.trim();

  if (envFileName === "") {
    throw new Error("--env-file requires a file name");
  }

  return envFileName;
}

main(process.argv.slice(2))
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`envguard: ${message}`);
    process.exitCode = 1;
  });
