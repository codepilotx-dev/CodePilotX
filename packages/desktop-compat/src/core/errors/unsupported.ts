export class UnsupportedCoreFeatureError extends Error {
  readonly feature: string

  constructor(feature: string, detail?: string) {
    super(
      detail
        ? `当前 core 暂不支持/迁移中: ${feature}. ${detail}`
        : `当前 core 暂不支持/迁移中: ${feature}`,
    )
    this.name = 'UnsupportedCoreFeatureError'
    this.feature = feature
  }
}

export function unsupportedCoreFeature(
  feature: string,
  detail?: string,
): never {
  throw new UnsupportedCoreFeatureError(feature, detail)
}
