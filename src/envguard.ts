import { promises as fs } from "node:fs";
import path from "node:path";

const IGNORED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next"
]);

const SOURCE_EXTENSIONS = new Set([
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

export const DEFAULT_ENV_FILE_NAME = ".env.example";

export type ScanResult = {
  filesScanned: number;
  referencedVariables: string[];
};

export type CheckResult = ScanResult & {
  definedVariables: string[];
  missingVariables: string[];
};

export function findEnvReferences(source: string): Set<string> {
  const variables = new Set<string>();

  for (const match of source.matchAll(ENV_REFERENCE_PATTERN)) {
    variables.add(match[1]);
  }

  return variables;
}

export function parseEnvExample(source: string): Set<string> {
  const variables = new Set<string>();

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

export async function readEnvExample(filePath: string): Promise<Set<string>> {
  const envFileName = path.basename(filePath);

  try {
    const source = await fs.readFile(filePath, "utf8");
    return parseEnvExample(source);
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

  const referencedVariables = new Set<string>();
  let filesScanned = 0;

  async function walk(currentDir: string): Promise<void> {
    let entries;

    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch (error) {
      throw new Error(`Could not read directory ${currentDir}: ${getErrorMessage(error)}`);
    }

    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) {
          await walk(entryPath);
        }

        continue;
      }

      if (!entry.isFile() || !isSourceFile(entry.name)) {
        continue;
      }

      let source;

      try {
        source = await fs.readFile(entryPath, "utf8");
      } catch (error) {
        throw new Error(`Could not read source file ${entryPath}: ${getErrorMessage(error)}`);
      }

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

  const missingVariables = scanResult.referencedVariables.filter(
    (variable) => !definedVariablesSet.has(variable)
  );

  return {
    ...scanResult,
    definedVariables: sortSet(definedVariablesSet),
    missingVariables
  };
}

function isSourceFile(fileName: string): boolean {
  if (fileName.endsWith(".d.ts")) {
    return false;
  }

  return SOURCE_EXTENSIONS.has(path.extname(fileName));
}

async function statDirectory(rootDir: string) {
  try {
    return await fs.stat(rootDir);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error(`Scan target does not exist: ${rootDir}`);
    }

    throw new Error(`Could not access scan target ${rootDir}: ${getErrorMessage(error)}`);
  }
}

function sortSet(values: Set<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function validateEnvFileName(envFileName: string): void {
  if (envFileName.trim() === "") {
    throw new Error("Env file name cannot be empty");
  }

  if (
    path.isAbsolute(envFileName) ||
    envFileName.includes("/") ||
    envFileName.includes("\\")
  ) {
    throw new Error(`Env file must be a file name, not a path: ${envFileName}`);
  }
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
  let entries;

  try {
    entries = await fs.readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (
      isNodeError(error) &&
      (error.code === "ENOENT" || error.code === "EACCES" || error.code === "EPERM")
    ) {
      return [];
    }

    throw new Error(`Could not read directory ${directoryPath}: ${getErrorMessage(error)}`);
  }

  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name !== envFileName &&
        entry.name.startsWith(".env") &&
        entry.name.endsWith(".example")
    )
    .map((entry) => path.join(directoryPath, entry.name));
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
