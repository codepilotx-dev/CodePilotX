import { describe, expect, test } from 'bun:test'
import type { PetCatalogItem } from '@codepilotx/agent-protocol'
import {
  filterPetCatalog,
  listPetCatalogCategories,
  petLicenseNeedsConfirmation,
} from '../src/features/pet/petCatalogModel.js'

const PETS: PetCatalogItem[] = [
  pet({
    slug: 'firefly--lingxiaotian',
    displayName: '流萤',
    englishName: 'Firefly',
    author: 'Lingxiaotian',
    category: 'games',
    categoryLabel: '游戏',
    spriteVersionNumber: 1,
  }),
  pet({
    slug: 'hami--tat',
    displayName: '哈米',
    englishName: 'Hami',
    author: 'Tat',
    category: 'original',
    categoryLabel: '原创',
    spriteVersionNumber: 2,
  }),
]

describe('pet catalog filters', () => {
  test('searches localized names and authors before applying category and version', () => {
    expect(filterPetCatalog(PETS, {
      query: 'firefly',
      category: '',
      version: 'all',
    }).map(item => item.slug)).toEqual(['firefly--lingxiaotian'])

    expect(filterPetCatalog(PETS, {
      query: 'tat',
      category: 'original',
      version: 2,
    }).map(item => item.slug)).toEqual(['hami--tat'])

    expect(filterPetCatalog(PETS, {
      query: '',
      category: 'games',
      version: 2,
    })).toEqual([])
  })

  test('builds a unique localized category list', () => {
    expect(listPetCatalogCategories([...PETS, PETS[0]!])).toEqual([
      { id: 'games', label: '游戏' },
      { id: 'original', label: '原创' },
    ])
  })
})

describe('pet catalog licenses', () => {
  test('only requires confirmation for restricted or unknown licenses', () => {
    expect(petLicenseNeedsConfirmation('permissive')).toBe(false)
    expect(petLicenseNeedsConfirmation('attribution')).toBe(false)
    expect(petLicenseNeedsConfirmation('restricted')).toBe(true)
    expect(petLicenseNeedsConfirmation('unknown')).toBe(true)
  })
})

function pet(
  patch: Partial<PetCatalogItem> & Pick<PetCatalogItem, 'slug'>,
): PetCatalogItem {
  return {
    slug: patch.slug,
    displayName: patch.displayName ?? patch.slug,
    author: patch.author ?? 'Author',
    category: patch.category ?? 'other',
    categoryLabel: patch.categoryLabel ?? '其他',
    spriteVersionNumber: patch.spriteVersionNumber ?? 1,
    license: patch.license ?? 'MIT',
    licenseKind: patch.licenseKind ?? 'permissive',
    previewUrl: patch.previewUrl ?? `/api/pets/catalog/${patch.slug}/preview`,
    installed: patch.installed ?? false,
    ...(patch.englishName === undefined
      ? {}
      : { englishName: patch.englishName }),
    ...(patch.description === undefined
      ? {}
      : { description: patch.description }),
  }
}
