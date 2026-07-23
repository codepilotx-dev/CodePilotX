import type {
  PetCatalogItem,
  PetLicenseKind,
} from '@codepilotx/agent-protocol'

export type PetCatalogVersionFilter = 'all' | 1 | 2

export type PetCatalogCategoryOption = {
  id: string
  label: string
}

export type PetCatalogFilters = {
  query: string
  category: string
  version: PetCatalogVersionFilter
}

export function filterPetCatalog(
  pets: readonly PetCatalogItem[],
  filters: PetCatalogFilters,
): PetCatalogItem[] {
  const query = filters.query.trim().toLocaleLowerCase()
  return pets.filter(pet => {
    if (filters.category && pet.category !== filters.category) return false
    if (
      filters.version !== 'all'
      && pet.spriteVersionNumber !== filters.version
    ) {
      return false
    }
    if (!query) return true
    return [
      pet.displayName,
      pet.englishName,
      pet.author,
      pet.description,
    ].some(value => value?.toLocaleLowerCase().includes(query))
  })
}

export function listPetCatalogCategories(
  pets: readonly PetCatalogItem[],
): PetCatalogCategoryOption[] {
  const labels = new Map<string, string>()
  for (const pet of pets) {
    if (!labels.has(pet.category)) {
      labels.set(pet.category, pet.categoryLabel)
    }
  }
  return [...labels]
    .map(([id, label]) => ({ id, label }))
    .sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'))
}

export function petLicenseNeedsConfirmation(
  kind: PetLicenseKind,
): boolean {
  return kind === 'restricted' || kind === 'unknown'
}

export function petLicenseLabel(kind: PetLicenseKind): string {
  switch (kind) {
    case 'permissive':
      return '宽松许可'
    case 'attribution':
      return '需要署名'
    case 'restricted':
      return '限制使用'
    case 'unknown':
      return '许可未知'
  }
}
