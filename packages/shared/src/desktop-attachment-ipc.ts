export const DESKTOP_ATTACHMENT_IPC_CHANNELS = {
  saveToDownloads: "desktop-attachment:save-to-downloads",
} as const

export type DesktopAttachmentSaveInput = {
  kind: "image" | "text"
  name: string
  mediaType: string
  encoding: "base64" | "utf8"
  data: string
}

export type DesktopAttachmentSaveResult = {
  fileName: string
}

export interface DesktopAttachmentIpcBridge {
  saveAttachmentToDownloads(
    input: DesktopAttachmentSaveInput,
  ): Promise<DesktopAttachmentSaveResult>
}
