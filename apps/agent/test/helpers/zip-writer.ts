/**
 * 测试用最小 ZIP writer（store 方法，无压缩）。
 *
 * 仅用于构造 .cpxplugin fixture 与恶意包（路径穿越、symlink、重复路径等）。
 * 支持覆盖 externalFileAttributes 以模拟符号链接等条目类型。
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  return table
})()

export const crc32 = (data: Uint8Array): number => {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i += 1) {
    crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

export interface ZipEntryInput {
  path: string
  content?: string | Uint8Array
  /** 覆盖 externalFileAttributes（高 16 位 unix type）。 */
  externalFileAttributes?: number
}

const u16 = (value: number, buffer: Buffer, offset: number) => {
  buffer.writeUInt16LE(value & 0xffff, offset)
}

const u32 = (value: number, buffer: Buffer, offset: number) => {
  buffer.writeUInt32LE(value >>> 0, offset)
}

const toBytes = (content: string | Uint8Array | undefined): Uint8Array =>
  typeof content === "string" ? new TextEncoder().encode(content) : content ?? new Uint8Array()

export const createZipBuffer = (entries: ZipEntryInput[]): Uint8Array => {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  const names: string[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.path, "utf8")
    const data = Buffer.from(toBytes(entry.content))
    const isDirectory = entry.path.endsWith("/")
    const external = entry.externalFileAttributes ?? (isDirectory ? (0o040755 << 16) | 0x10 : (0o100644 << 16) | 0)
    const crc = crc32(data)

    // local file header
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    u16(20, local, 4) // version needed
    u16(0x0800, local, 6) // UTF-8 flags
    u16(0, local, 8) // store
    u16(0, local, 10) // dos time
    u16(0x21, local, 12) // dos date
    u32(crc, local, 14)
    u32(data.length, local, 18)
    u32(data.length, local, 22)
    u16(nameBytes.length, local, 26)
    u16(0, local, 28)
    localParts.push(local, nameBytes, data)

    // central directory
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    u16(0x031e, central, 4) // version made by: unix, 3.0
    u16(20, central, 6)
    u16(0x0800, central, 8)
    u16(0, central, 10)
    u16(0, central, 12)
    u16(0x21, central, 14)
    u32(crc, central, 16)
    u32(data.length, central, 20)
    u32(data.length, central, 24)
    u16(nameBytes.length, central, 28)
    u16(0, central, 30)
    u16(0, central, 32)
    u16(0, central, 34)
    u16(0, central, 36)
    u32(external, central, 38)
    u32(offset, central, 42)
    centralParts.push(central, nameBytes)

    names.push(entry.path)
    offset += 30 + nameBytes.length + data.length
  }

  const centralDirectory = Buffer.concat(centralParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  u16(0, eocd, 4)
  u16(0, eocd, 6)
  u16(names.length, eocd, 8)
  u16(names.length, eocd, 10)
  u32(centralDirectory.length, eocd, 12)
  u32(offset, eocd, 16)
  u16(0, eocd, 20)

  return Buffer.concat([...localParts, centralDirectory, eocd])
}

export const writeZip = async (path: string, entries: ZipEntryInput[]): Promise<void> => {
  await Bun.write(path, createZipBuffer(entries))
}
