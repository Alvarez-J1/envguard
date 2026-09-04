import { promises as fs } from "node:fs";
import type { Dirent, Stats } from "node:fs";
import path from "node:path";

const IGNORED_DIRECTORIES: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next"
]);

const SOURCE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts"
]);

const ENV_REFERENCE_PATTERN = /\bprocess\s*\.\s*env\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)\b/g;
const ENV_EXAMPLE_LINE_PATTERN = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;
const ENV_FILE_PREFIX = ".env";
const EXAMPLE_FILE_SUFFIX = ".example";
const TEXT_FILE_ENCODING = "utf8";

export const DEFAULT_ENV_FILE_NAME = ".env.example";

export type EnvVariableName = string;

export type ScanResult = {
  filesScanned: number;
  referencedVariables: EnvVariableName[];
};

export type CheckResult = ScanResult & {
  definedVariables: EnvVariableName[];
  missingVariables: EnvVariableName[];
};

export function findEnvReferences(source: string): Set<EnvVariableName> {
  const variables = new Set<EnvVariableName>();

  for (const match of source.matchAll(ENV_REFERENCE_PATTERN)) {
    variables.add(match[1]);
  }

  return variables;
}

export function parseEnvExample(source: string): Set<EnvVariableName> {
  const variables = new Set<EnvVariableName>();

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (line === "" || line.startsWith("#")) {
      continue;
    }

    const match = line.match(ENV_EXAMPLE_LINE_PATTERN);

    if (match) {
      variables.add(match[1]);
    }
  }

  return variables;
}

export async function readEnvExample(filePath: string): Promise<Set<EnvVariableName>> {
  const envFileName = path.basename(filePath);
  const source = await readEnvExampleSource(filePath, envFileName);

  return parseEnvExample(source);
}

async function readEnvExampleSource(filePath: string, envFileName: string): Promise<string> {
  try {
    return await fs.readFile(filePath, TEXT_FILE_ENCODING);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error(`Could not find ${envFileName} at ${filePath}`);
    }

    throw new Error(`Could not read ${envFileName} at ${filePath}: ${getErrorMessage(error)}`);
  }
}

export async function findEnvExamplePath(
  startDir: string,
  envFileName = DEFAULT_ENV_FILE_NAME
): Promise<string> {
  validateEnvFileName(envFileName);

  let currentDir = path.resolve(startDir);
  const startStats = await statDirectory(currentDir);
  const alternativePaths = new Set<string>();

  if (!startStats.isDirectory()) {
    throw new Error(`Scan target is not a directory: ${currentDir}`);
  }

  while (true) {
    const candidatePath = path.join(currentDir, envFileName);

    if (await fileExists(candidatePath)) {
      return candidatePath;
    }

    for (const alternativePath of await findEnvExampleAlternatives(currentDir, envFileName)) {
      alternativePaths.add(alternativePath);
    }

    const parentDir = path.dirname(currentDir);

    if (parentDir === currentDir) {
      throw new Error(createMissingEnvExampleMessage(startDir, envFileName, alternativePaths));
    }

    currentDir = parentDir;
  }
}

export async function scanDirectory(rootDir: string): Promise<ScanResult> {
  const rootStats = await statDirectory(rootDir);

  if (!rootStats.isDirectory()) {
    throw new Error(`Scan target is not a directory: ${rootDir}`);
  }

  const referencedVariables = new Set<EnvVariableName>();
  let filesScanned = 0;

  async function walk(currentDir: string): Promise<void> {
    let entries: Dirent[];

    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch (error) {
      throw new Error(`Could not read directory ${currentDir}: ${getErrorMessage(error)}`);
    }

    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (!isIgnoredDirectory(entry.name)) {
          await walk(entryPath);
        }

        continue;
      }

      if (!entry.isFile() || !isSourceFile(entry.name)) {
        continue;
      }

      const source = await readSourceFile(entryPath);
      filesScanned += 1;

      for (const variable of findEnvReferences(source)) {
        referencedVariables.add(variable);
      }
    }
  }

  await walk(rootDir);

  return {
    filesScanned,
    referencedVariables: sortSet(referencedVariables)
  };
}

export async function checkEnvironmentVariables(
  targetDir: string,
  envExamplePath: string
): Promise<CheckResult> {
  const [scanResult, definedVariablesSet] = await Promise.all([
    scanDirectory(targetDir),
    readEnvExample(envExamplePath)
  ]);

  const missingVariables = findMissingVariables(
    scanResult.referencedVariables,
    definedVariablesSet
  );

  return {
    ...scanResult,
    definedVariables: sortSet(definedVariablesSet),
    missingVariables
  };
}

function isSourceFile(fileName: string): boolean {
  if (isDeclarationFile(fileName)) {
    return false;
  }

  return SOURCE_EXTENSIONS.has(path.extname(fileName));
}

function isDeclarationFile(fileName: string): boolean {
  return fileName.endsWith(".d.ts");
}

function isIgnoredDirectory(directoryName: string): boolean {
  return IGNORED_DIRECTORIES.has(directoryName);
}

function findMissingVariables(
  referencedVariables: readonly EnvVariableName[],
  definedVariables: ReadonlySet<EnvVariableName>
): EnvVariableName[] {
  return referencedVariables.filter((variable) => !definedVariables.has(variable));
}

async function readSourceFile(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, TEXT_FILE_ENCODING);
  } catch (error) {
    throw new Error(`Could not read source file ${filePath}: ${getErrorMessage(error)}`);
  }
}

async function statDirectory(rootDir: string): Promise<Stats> {
  try {
    return await fs.stat(rootDir);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error(`Scan target does not exist: ${rootDir}`);
    }

    throw new Error(`Could not access scan target ${rootDir}: ${getErrorMessage(error)}`);
  }
}

function sortSet<T extends string>(values: ReadonlySet<T>): T[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function validateEnvFileName(envFileName: string): void {
  if (envFileName.trim() === "") {
    throw new Error("Env file name cannot be empty");
  }

  if (path.isAbsolute(envFileName) || hasPathSeparator(envFileName)) {
    throw new Error(`Env file must be a file name, not a path: ${envFileName}`);
  }
}

function hasPathSeparator(fileName: string): boolean {
  return fileName.includes("/") || fileName.includes("\\");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile();
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }

    throw new Error(`Could not access ${filePath}: ${getErrorMessage(error)}`);
  }
}

async function findEnvExampleAlternatives(
  directoryPath: string,
  envFileName: string
): Promise<string[]> {
  let entries: Dirent[];

  try {
    entries = await fs.readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (isRecoverableDirectoryReadError(error)) {
      return [];
    }

    throw new Error(`Could not read directory ${directoryPath}: ${getErrorMessage(error)}`);
  }

  return entries
    .filter((entry) => isEnvExampleAlternative(entry, envFileName))
    .map((entry) => path.join(directoryPath, entry.name));
}

function isEnvExampleAlternative(entry: Dirent, envFileName: string): boolean {
  return (
    entry.isFile() &&
    entry.name !== envFileName &&
    isEnvExampleAlternativeName(entry.name)
  );
}

function isEnvExampleAlternativeName(fileName: string): boolean {
  return fileName.startsWith(ENV_FILE_PREFIX) && fileName.endsWith(EXAMPLE_FILE_SUFFIX);
}

function createMissingEnvExampleMessage(
  startDir: string,
  envFileName: string,
  alternativePaths: Set<string>
): string {
  const baseMessage = `Could not find ${envFileName} in ${startDir} or any parent directory`;
  const sortedAlternativePaths = sortSet(alternativePaths);

  if (sortedAlternativePaths.length === 0) {
    return baseMessage;
  }

  return `${baseMessage}. Found ${sortedAlternativePaths.join(", ")} instead. envguard expects the file to be named ${envFileName}.`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isRecoverableDirectoryReadError(error: unknown): boolean {
  return (
    isNodeError(error) &&
    (error.code === "ENOENT" || error.code === "EACCES" || error.code === "EPERM")
  );
}
