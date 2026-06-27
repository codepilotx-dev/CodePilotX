export type MaybePromise<T> = T | Promise<T>
export type Nullable<T> = T | null
export type Optional<T> = T | undefined
export type DeepPartial<T> = { [P in keyof T]?: DeepPartial<T[P]> }
export type ValueOf<T> = T[keyof T]
export type NonNullableFields<T> = { [P in keyof T]: NonNullable<T[P]> }
export type OmitNever<T> = { [K in keyof T as T[K] extends never ? never : K]: T[K] }
export type DeepImmutable<T> = { readonly [P in keyof T]: DeepImmutable<T[P]> }
