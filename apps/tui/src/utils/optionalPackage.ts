import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, normalize, sep } from 'node:path'

const require = createRequire(import.meta.url)

type PackageJson = {
  name?: string
  version?: string
}

export type OptionalPackageAvailability =
  | { available: true; resolvedPath: string }
  | { available: false; reason: string }

function findPackageJsonPath(resolvedPath: string): string | undefined {
  let dir = dirname(resolvedPath)
  while (true) {
    const candidate = join(dir, 'package.json')
    if (existsSync(candidate)) {
      return candidate
    }
    const parent = dirname(dir)
    if (parent === dir) {
      return undefined
    }
    dir = parent
  }
}

function readPackageJson(path: string): PackageJson | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as PackageJson
  } catch {
    return undefined
  }
}

function isStubPackage(resolvedPath: string, pkg?: PackageJson): boolean {
  const normalized = normalize(resolvedPath)
  return (
    normalized.includes(`${sep}stubs${sep}`) ||
    pkg?.version === '0.0.0-local' ||
    pkg?.name === 'native-empty'
  )
}

export function getOptionalPackageAvailability(
  specifier: string,
): OptionalPackageAvailability {
  let resolvedPath: string
  try {
    resolvedPath = require.resolve(specifier)
  } catch (error) {
    return {
      available: false,
      reason:
        error instanceof Error
          ? error.message
          : `Unable to resolve optional package ${specifier}`,
    }
  }

  const packageJsonPath = findPackageJsonPath(resolvedPath)
  const packageJson = packageJsonPath
    ? readPackageJson(packageJsonPath)
    : undefined
  if (isStubPackage(resolvedPath, packageJson)) {
    return {
      available: false,
      reason: `${specifier} resolves to local stub package`,
    }
  }

  return { available: true, resolvedPath }
}

export function isOptionalPackageAvailable(specifier: string): boolean {
  return getOptionalPackageAvailability(specifier).available
}

export async function importOptionalPackage<T>(
  specifier: string,
): Promise<T | undefined> {
  if (!isOptionalPackageAvailable(specifier)) {
    return undefined
  }
  return (await import(specifier)) as T
}

export function requireOptionalPackage<T>(specifier: string): T | undefined {
  if (!isOptionalPackageAvailable(specifier)) {
    return undefined
  }
  try {
    return require(specifier) as T
  } catch {
    return undefined
  }
}
