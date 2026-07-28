import { useEffect, useState, type ComponentType } from "react"
import type { MaterialSvgIconProps } from "./icons"
import {
  iconShard,
  loadIconShard,
  type IconComponent,
  type IconName,
} from "./icons"
import FileIconComponent from "./icons/file"
import FolderIconComponent from "./icons/folder"
import FolderOpenIconComponent from "./icons/folder-open"
import FolderRootIconComponent from "./icons/folder-root"
import FolderRootOpenIconComponent from "./icons/folder-root-open"
import { loadCachedIconShard } from "./icon-shard-cache"
import {
  resolveFileIconName,
  resolveFolderIconName,
  type ResolveFileIconOptions,
  type ResolveFolderIconOptions,
} from "./resolve"

export interface MaterialIconProps extends MaterialSvgIconProps {
  name: IconName
}

export function MaterialIcon({ name, ...props }: MaterialIconProps) {
  return <AsyncMaterialIcon fallback={FileIconComponent} name={name} {...props} />
}

const componentCache = new Map<IconName, IconComponent>([
  ["file", FileIconComponent],
  ["folder", FolderIconComponent],
  ["folder-open", FolderOpenIconComponent],
  ["folder-root", FolderRootIconComponent],
  ["folder-root-open", FolderRootOpenIconComponent],
])
const shardCache = new Map<number, Promise<void>>()

function AsyncMaterialIcon({
  fallback: Fallback,
  name,
  ...props
}: MaterialIconProps & { fallback: ComponentType<MaterialSvgIconProps> }) {
  const [Icon, setIcon] = useState<IconComponent>(() =>
    componentCache.get(name) ?? Fallback,
  )

  useEffect(() => {
    const cached = componentCache.get(name)
    if (cached) {
      setIcon(() => cached)
      return
    }

    setIcon(() => Fallback)
    let active = true
    const shard = iconShard(name)
    const loading = loadCachedIconShard(shardCache, shard, () =>
      loadIconShard(name).then(components => {
        for (const [iconName, component] of Object.entries(components)) {
          if (component) componentCache.set(iconName as IconName, component)
        }
      }),
    )
    void loading.then(() => {
      const loaded = componentCache.get(name)
      if (active && loaded) setIcon(() => loaded)
    })
    return () => {
      active = false
    }
  }, [Fallback, name])

  return <Icon {...props} />
}

export interface FileIconProps
  extends Omit<MaterialIconProps, "name" | "path">,
    ResolveFileIconOptions {
  path?: string | null
}

export function FileIcon({
  path,
  language,
  languageId,
  parentPath,
  parentDirectory,
  ...props
}: FileIconProps) {
  const name = resolveFileIconName(path ?? "", {
    language,
    languageId,
    parentPath,
    parentDirectory,
  })
  return (
    <AsyncMaterialIcon
      fallback={FileIconComponent}
      name={name}
      {...props}
    />
  )
}

export interface FolderIconProps
  extends Omit<MaterialIconProps, "name" | "path">,
    ResolveFolderIconOptions {
  path?: string | null
}

export function FolderIcon({
  path,
  expanded,
  root,
  parentPath,
  parentDirectory,
  ...props
}: FolderIconProps) {
  const name = resolveFolderIconName(path ?? "", {
    expanded,
    root,
    parentPath,
    parentDirectory,
  })
  const fallback = root
    ? expanded
      ? FolderRootOpenIconComponent
      : FolderRootIconComponent
    : expanded
      ? FolderOpenIconComponent
      : FolderIconComponent
  return <AsyncMaterialIcon fallback={fallback} name={name} {...props} />
}
