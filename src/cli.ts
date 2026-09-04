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

const EXIT_SUCCESS = 0;
const EXIT_FAILURE = 1;
type ExitCode = typeof EXIT_SUCCESS | typeof EXIT_FAILURE;
const ENV_FILE_OPTION = "--env-file";
const EXAMPLE_FILE_OPTION = "--example-file";
const ENV_FILE_ASSIGNMENT_PREFIX = `${ENV_FILE_OPTION}=`;
const EXAMPLE_FILE_ASSIGNMENT_PREFIX = `${EXAMPLE_FILE_OPTION}=`;

const USAGE = `Usage: envguard [options] [directory]

Checks JavaScript and TypeScript files for process.env.NAME references and
verifies that each NAME exists in an example env file.

Options:
  --example-file <name>  Example env file name to check (default: .env.example)
  --env-file <name>      Alias for --example-file
  -h, --help             Show this help message

Examples:
  envguard
  envguard ./src
  envguard --example-file .env.local.example ./src`;

async function main(args: string[]): Promise<ExitCode> {
  const options = parseArgs(args);

  if (options.help) {
    console.log(USAGE);
    return EXIT_SUCCESS;
  }

  const targetDir = resolveTargetDir(options.targetDirArg);
  const envExamplePath = await findEnvExamplePath(targetDir, options.envFileName);
  const result = await checkEnvironmentVariables(targetDir, envExamplePath);

  if (result.missingVariables.length > 0) {
    printMissingVariables(result.missingVariables, result.filesScanned, options.envFileName);
    return EXIT_FAILURE;
  }

  printSuccess(result.referencedVariables.length, result.filesScanned, options.envFileName);
  return EXIT_SUCCESS;
}

function parseArgs(args: string[]): CliOptions {
  const positionalArgs: string[] = [];
  let envFileName = DEFAULT_ENV_FILE_NAME;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (isHelpArg(arg)) {
      return { envFileName, help: true };
    }

    if (isOptionSeparator(arg)) {
      continue;
    }

    if (arg === ENV_FILE_OPTION || arg === EXAMPLE_FILE_OPTION) {
      const value = args[index + 1];

      if (value === undefined || value.startsWith("-")) {
        throw new Error(`${arg} requires a file name`);
      }

      envFileName = parseEnvFileName(value);
      index += 1;
      continue;
    }

    if (arg.startsWith(ENV_FILE_ASSIGNMENT_PREFIX)) {
      envFileName = parseEnvFileName(arg.slice(ENV_FILE_ASSIGNMENT_PREFIX.length));
      continue;
    }

    if (arg.startsWith(EXAMPLE_FILE_ASSIGNMENT_PREFIX)) {
      envFileName = parseEnvFileName(arg.slice(EXAMPLE_FILE_ASSIGNMENT_PREFIX.length));
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
    throw new Error("Env file option requires a file name");
  }

  return envFileName;
}

function resolveTargetDir(targetDirArg: string | undefined): string {
  return path.resolve(process.cwd(), targetDirArg ?? ".");
}

function printSuccess(
  referencedVariableCount: number,
  filesScanned: number,
  envFileName: string
): void {
  console.log(
    `envguard: all ${referencedVariableCount} referenced environment variable(s) are declared in ${envFileName}`
  );
  console.log(`Scanned ${filesScanned} source file(s).`);
}

function printMissingVariables(
  missingVariables: readonly string[],
  filesScanned: number,
  envFileName: string
): void {
  console.error(`envguard: missing variables in ${envFileName}`);
  console.error("");

  for (const variable of missingVariables) {
    console.error(`  ${variable}`);
  }

  console.error("");
  console.error(`Scanned ${filesScanned} source file(s).`);
}

function isHelpArg(arg: string): boolean {
  return arg === "--help" || arg === "-h";
}

function isOptionSeparator(arg: string): boolean {
  return arg === "--";
}

main(process.argv.slice(2))
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`envguard: ${message}`);
    process.exitCode = EXIT_FAILURE;
  });
