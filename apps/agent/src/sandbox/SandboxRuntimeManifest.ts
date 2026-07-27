export const SRT_RUNTIME_VERSION = "0.0.65"
export const SRT_WINDOWS_MATURITY = "alpha" as const
export const SRT_MAX_CONCURRENT_COMMANDS = 8
export const SRT_PROXY_PORT_RANGE = [60080, 60095] as const
export const SRT_INSTALL_GENERATION = 2
export const SRT_WORKER_PROTOCOL_VERSION = 2
export const SRT_WORKER_IDLE_TIMEOUT_MS = 120_000

export const SRT_WINDOWS_HELPER_SHA256 = {
  x64: "777736e17d6cf9b4280f155f5cda731fdff0f789fa16e6cb3adc0006073e241a",
  arm64: "17a63aa8c010662b3e723f75d13d8672c69beeca8d072f4b2dce7484e850023a",
} as const

export type SrtWindowsArchitecture = keyof typeof SRT_WINDOWS_HELPER_SHA256
