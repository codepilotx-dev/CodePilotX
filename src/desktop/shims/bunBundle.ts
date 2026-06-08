const enabledFeatures = new Set<string>()

export function feature(name: string): boolean {
  return enabledFeatures.has(name)
}
