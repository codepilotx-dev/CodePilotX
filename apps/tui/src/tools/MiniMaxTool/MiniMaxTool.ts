import { existsSync } from 'fs'
import { z } from 'zod/v4'
import { buildTool, type ToolDef, type ToolUseContext } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { expandPath } from '../../utils/path.js'
import {
  checkReadPermissionForTool,
  checkWritePermissionForTool,
} from '../../utils/permissions/filesystem.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import {
  artifactSummary,
  downloadToArtifact,
  minimaxJSON,
  minimaxUploadFile,
  saveBase64Artifacts,
  saveHexArtifact,
  type MiniMaxJSON,
} from './client.js'

type MiniMaxToolOutput = {
  action: string
  response: MiniMaxJSON
  localFiles?: string[]
}

const aspectRatioSchema = z.enum([
  '1:1',
  '16:9',
  '4:3',
  '3:2',
  '2:3',
  '3:4',
  '9:16',
  '21:9',
])

const outputPathField = z
  .string()
  .optional()
  .describe(
    'Optional absolute local output file path. If omitted, files are written to ~/.oh-my-openagent/minimax/artifacts.',
  )

const imageInputSchema = lazySchema(() =>
  z.strictObject({
    prompt: z.string().min(1).max(1500).describe('Image prompt.'),
    model: z.enum(['image-01', 'image-01-live']).optional().default('image-01'),
    aspect_ratio: aspectRatioSchema.optional(),
    width: z.number().int().min(512).max(2048).optional(),
    height: z.number().int().min(512).max(2048).optional(),
    n: z.number().int().min(1).max(9).optional().default(1),
    seed: z.number().int().optional(),
    response_format: z.enum(['url', 'base64']).optional().default('url'),
    prompt_optimizer: z.boolean().optional(),
    aigc_watermark: z.boolean().optional(),
    subject_reference: z
      .array(
        z.strictObject({
          type: z.literal('character').default('character'),
          image_file: z
            .string()
            .describe('Public image URL or base64 data URL for image-to-image.'),
        }),
      )
      .optional(),
    output_path: outputPathField,
  }),
)

const speechInputSchema = lazySchema(() =>
  z.strictObject({
    text: z.string().min(1).describe('Text to synthesize.'),
    model: z.string().optional().default('speech-2.8-turbo'),
    voice_id: z.string().optional().default('male-qn-qingse'),
    output_format: z.enum(['mp3', 'wav', 'pcm']).optional().default('mp3'),
    sample_rate: z.number().int().optional(),
    bitrate: z.number().int().optional(),
    speed: z.number().min(0.5).max(2).optional(),
    volume: z.number().min(0).max(10).optional(),
    pitch: z.number().min(-12).max(12).optional(),
    async: z.boolean().optional().default(false),
    output_path: outputPathField,
  }),
)

const videoInputSchema = lazySchema(() =>
  z.strictObject({
    action: z.enum(['create', 'query', 'download']).default('create'),
    prompt: z.string().optional(),
    model: z.string().optional().default('T2V-01'),
    first_frame_image: z.string().optional(),
    last_frame_image: z.string().optional(),
    subject_reference: z
      .array(
        z.strictObject({
          type: z.string().default('character'),
          image: z.array(z.string()).min(1),
        }),
      )
      .optional(),
    duration: z.number().int().optional(),
    resolution: z.string().optional(),
    task_id: z.string().optional(),
    file_id: z.union([z.string(), z.number()]).optional(),
    output_path: outputPathField,
  }),
)

const musicInputSchema = lazySchema(() =>
  z.strictObject({
    action: z.enum(['generate', 'lyrics', 'cover']).default('generate'),
    model: z
      .enum(['music-2.6', 'music-cover', 'music-2.6-free', 'music-cover-free'])
      .optional()
      .default('music-2.6'),
    prompt: z.string().optional(),
    lyrics: z.string().optional(),
    lyrics_optimizer: z.boolean().optional(),
    is_instrumental: z.boolean().optional(),
    audio_url: z.string().optional(),
    audio_base64: z.string().optional(),
    cover_feature_id: z.string().optional(),
    output_format: z.enum(['url', 'hex']).optional().default('hex'),
    output_path: outputPathField,
  }),
)

const visionInputSchema = lazySchema(() =>
  z.strictObject({
    image: z
      .string()
      .describe('Public image URL, local file path, MiniMax file ID, or base64 data URL.'),
    prompt: z.string().optional().default('Describe this image in detail.'),
    endpoint: z
      .string()
      .optional()
      .default('/v1/vision/describe')
      .describe('MiniMax vision endpoint. Override if your account uses a different Token Plan endpoint.'),
  }),
)

const fileInputSchema = lazySchema(() =>
  z.strictObject({
    action: z.enum(['upload', 'list', 'retrieve', 'download', 'delete']),
    file_path: z.string().optional().describe('Local file path for upload.'),
    purpose: z
      .enum(['voice_clone', 'prompt_audio', 't2a_async_input', 'video_generation'])
      .optional()
      .default('t2a_async_input'),
    file_id: z.union([z.string(), z.number()]).optional(),
    output_path: outputPathField,
  }),
)

const quotaInputSchema = lazySchema(() => z.strictObject({}))

type ImageInputSchema = ReturnType<typeof imageInputSchema>
type SpeechInputSchema = ReturnType<typeof speechInputSchema>
type VideoInputSchema = ReturnType<typeof videoInputSchema>
type MusicInputSchema = ReturnType<typeof musicInputSchema>
type VisionInputSchema = ReturnType<typeof visionInputSchema>
type FileInputSchema = ReturnType<typeof fileInputSchema>
type QuotaInputSchema = ReturnType<typeof quotaInputSchema>

function outputSchema() {
  return z.object({
    action: z.string(),
    response: z.record(z.string(), z.unknown()),
    localFiles: z.array(z.string()).optional(),
  })
}

export const MiniMaxImageTool = buildTool({
  name: 'MiniMaxImage',
  searchHint: 'generate images with MiniMax',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Generate images with MiniMax text-to-image or image-to-image.'
  },
  async prompt() {
    return 'Use this tool to generate images with MiniMax image-01/image-01-live. Provide a prompt, optional size/aspect ratio, optional subject_reference for image-to-image, and optional output_path.'
  },
  get inputSchema(): ImageInputSchema {
    return imageInputSchema()
  },
  get outputSchema() {
    return outputSchema()
  },
  isConcurrencySafe() {
    return true
  },
  getPath(input) {
    return input.output_path ?? ''
  },
  async checkPermissions(input, context) {
    return checkOutputPathPermission(MiniMaxImageTool, input, context)
  },
  renderToolUseMessage(input) {
    return `MiniMax image: ${input.prompt ?? ''}`
  },
  async call(input) {
    const response = await minimaxJSON({
      path: '/v1/image_generation',
      body: stripUndefined({
        model: input.model,
        prompt: input.prompt,
        aspect_ratio: input.aspect_ratio,
        width: input.width,
        height: input.height,
        response_format: input.response_format,
        seed: input.seed,
        n: input.n,
        prompt_optimizer: input.prompt_optimizer,
        aigc_watermark: input.aigc_watermark,
        subject_reference: input.subject_reference,
      }),
    })
    const localFiles = await saveImageOutputs(response, input.output_path)
    return { data: { action: 'image', response, localFiles } }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return toolResult(toolUseID, output)
  },
} satisfies ToolDef<ImageInputSchema, MiniMaxToolOutput>)

export const MiniMaxSpeechTool = buildTool({
  name: 'MiniMaxSpeech',
  searchHint: 'text to speech audio generation',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Generate speech audio with MiniMax T2A.'
  },
  async prompt() {
    return 'Use this tool to synthesize speech with MiniMax. For long text set async=true to create an asynchronous T2A task; otherwise the tool uses the synchronous HTTP endpoint and saves returned audio when available.'
  },
  get inputSchema(): SpeechInputSchema {
    return speechInputSchema()
  },
  get outputSchema() {
    return outputSchema()
  },
  getPath(input) {
    return input.output_path ?? ''
  },
  async checkPermissions(input, context) {
    return checkOutputPathPermission(MiniMaxSpeechTool, input, context)
  },
  renderToolUseMessage(input) {
    return `MiniMax speech: ${(input.text ?? '').slice(0, 80)}`
  },
  async call(input) {
    const body = stripUndefined({
      model: input.model,
      text: input.text,
      voice_setting: { voice_id: input.voice_id },
      audio_setting: {
        format: input.output_format,
        sample_rate: input.sample_rate,
        bitrate: input.bitrate,
      },
      timber_weights: undefined,
      speed: input.speed,
      volume: input.volume,
      pitch: input.pitch,
    })
    const response = await minimaxJSON({
      path: input.async ? '/v1/t2a_async_v2' : '/v1/t2a_v2',
      body,
    })
    const localFiles = await saveAudioOutputs(
      response,
      input.output_path,
      input.output_format,
    )
    return { data: { action: input.async ? 'speech_async' : 'speech', response, localFiles } }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return toolResult(toolUseID, output)
  },
} satisfies ToolDef<SpeechInputSchema, MiniMaxToolOutput>)

export const MiniMaxVideoTool = buildTool({
  name: 'MiniMaxVideo',
  searchHint: 'create query download videos',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Create, query, and download MiniMax video generation tasks.'
  },
  async prompt() {
    return 'Use this tool for MiniMax video generation. action=create returns a task_id; action=query checks task status; action=download downloads a file_id to local artifacts or output_path.'
  },
  get inputSchema(): VideoInputSchema {
    return videoInputSchema()
  },
  get outputSchema() {
    return outputSchema()
  },
  getPath(input) {
    return input.output_path ?? ''
  },
  async checkPermissions(input, context) {
    return checkOutputPathPermission(MiniMaxVideoTool, input, context)
  },
  renderToolUseMessage(input) {
    return `MiniMax video: ${input.action ?? 'create'}`
  },
  async call(input) {
    if (input.action === 'query') {
      requireField(input.task_id, 'task_id')
      const response = await minimaxJSON({
        path: '/v1/query/video_generation',
        method: 'GET',
        query: { task_id: input.task_id },
      })
      return { data: { action: 'video_query', response } }
    }
    if (input.action === 'download') {
      requireField(input.file_id, 'file_id')
      const response = await minimaxJSON({
        path: '/v1/files/retrieve',
        method: 'GET',
        query: { file_id: input.file_id },
      })
      const url = extractDownloadURL(response)
      const localFiles = url
        ? [await downloadToArtifact({ url, outputPath: input.output_path, subdir: 'video', extension: '.mp4' })]
        : []
      return { data: { action: 'video_download', response, localFiles } }
    }
    const response = await minimaxJSON({
      path: '/v1/video_generation',
      body: stripUndefined({
        model: input.model,
        prompt: input.prompt,
        first_frame_image: input.first_frame_image,
        last_frame_image: input.last_frame_image,
        subject_reference: input.subject_reference,
        duration: input.duration,
        resolution: input.resolution,
      }),
    })
    return { data: { action: 'video_create', response } }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return toolResult(toolUseID, output)
  },
} satisfies ToolDef<VideoInputSchema, MiniMaxToolOutput>)

export const MiniMaxMusicTool = buildTool({
  name: 'MiniMaxMusic',
  searchHint: 'generate music lyrics cover',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Generate music, lyrics, or covers with MiniMax.'
  },
  async prompt() {
    return 'Use this tool for MiniMax music generation, lyrics generation, or music-cover workflows. It saves hex audio locally when returned.'
  },
  get inputSchema(): MusicInputSchema {
    return musicInputSchema()
  },
  get outputSchema() {
    return outputSchema()
  },
  getPath(input) {
    return input.output_path ?? ''
  },
  async checkPermissions(input, context) {
    return checkOutputPathPermission(MiniMaxMusicTool, input, context)
  },
  renderToolUseMessage(input) {
    return `MiniMax music: ${input.action ?? 'generate'}`
  },
  async call(input) {
    const path =
      input.action === 'lyrics' ? '/v1/lyrics_generation' : '/v1/music_generation'
    const response = await minimaxJSON({
      path,
      body: stripUndefined({
        model: input.action === 'lyrics' ? undefined : input.model,
        prompt: input.prompt,
        lyrics: input.lyrics,
        lyrics_optimizer: input.lyrics_optimizer,
        is_instrumental: input.is_instrumental,
        audio_url: input.audio_url,
        audio_base64: input.audio_base64,
        cover_feature_id: input.cover_feature_id,
        output_format: input.output_format,
      }),
    })
    const localFiles = await saveAudioOutputs(
      response,
      input.output_path,
      input.output_format === 'hex' ? 'mp3' : 'mp3',
    )
    return { data: { action: `music_${input.action}`, response, localFiles } }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return toolResult(toolUseID, output)
  },
} satisfies ToolDef<MusicInputSchema, MiniMaxToolOutput>)

export const MiniMaxVisionTool = buildTool({
  name: 'MiniMaxVision',
  searchHint: 'understand describe images',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Describe or understand an image with MiniMax vision.'
  },
  async prompt() {
    return 'Use this tool to ask MiniMax to understand an image. The default endpoint follows the Token Plan vision workflow; override endpoint if your MiniMax account uses a different vision endpoint.'
  },
  get inputSchema(): VisionInputSchema {
    return visionInputSchema()
  },
  get outputSchema() {
    return outputSchema()
  },
  isReadOnly() {
    return true
  },
  renderToolUseMessage(input) {
    return `MiniMax vision: ${input.image ?? ''}`
  },
  async call(input) {
    const response = await minimaxJSON({
      path: input.endpoint,
      body: { image: input.image, prompt: input.prompt },
    })
    return { data: { action: 'vision', response } }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return toolResult(toolUseID, output)
  },
} satisfies ToolDef<VisionInputSchema, MiniMaxToolOutput>)

export const MiniMaxFileTool = buildTool({
  name: 'MiniMaxFile',
  searchHint: 'upload list retrieve download delete MiniMax files',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Manage MiniMax platform files.'
  },
  async prompt() {
    return 'Use this tool to upload, list, retrieve, download, or delete files on MiniMax. Delete is destructive and requires confirmation.'
  },
  get inputSchema(): FileInputSchema {
    return fileInputSchema()
  },
  get outputSchema() {
    return outputSchema()
  },
  isReadOnly(input) {
    return input.action === 'list' || input.action === 'retrieve'
  },
  isDestructive(input) {
    return input.action === 'delete'
  },
  getPath(input) {
    return input.action === 'upload'
      ? input.file_path ?? ''
      : input.output_path ?? ''
  },
  async checkPermissions(input, context) {
    if (input.action === 'delete') {
      return {
        behavior: 'ask',
        message: `MiniMax remote file delete requested for file_id=${String(input.file_id ?? '')}.`,
      }
    }
    const appState = context.getAppState()
    if (input.action === 'upload' && input.file_path) {
      return checkReadPermissionForTool(
        MiniMaxFileTool,
        { ...input, file_path: expandPath(input.file_path) },
        appState.toolPermissionContext,
      )
    }
    return checkOutputPathPermission(MiniMaxFileTool, input, context)
  },
  renderToolUseMessage(input) {
    return `MiniMax file: ${input.action ?? ''}`
  },
  async call(input) {
    if (input.action === 'upload') {
      requireField(input.file_path, 'file_path')
      const response = await minimaxUploadFile({
        filePath: input.file_path,
        purpose: input.purpose,
      })
      return { data: { action: 'file_upload', response } }
    }
    if (input.action === 'list') {
      const response = await minimaxJSON({
        path: '/v1/files/list',
        method: 'GET',
        query: { purpose: input.purpose },
      })
      return { data: { action: 'file_list', response } }
    }
    requireField(input.file_id, 'file_id')
    if (input.action === 'retrieve') {
      const response = await minimaxJSON({
        path: '/v1/files/retrieve',
        method: 'GET',
        query: { file_id: input.file_id },
      })
      return { data: { action: 'file_retrieve', response } }
    }
    if (input.action === 'download') {
      const response = await minimaxJSON({
        path: '/v1/files/retrieve',
        method: 'GET',
        query: { file_id: input.file_id },
      })
      const url = extractDownloadURL(response)
      const localFiles = url
        ? [await downloadToArtifact({ url, outputPath: input.output_path, subdir: 'files', extension: '.bin' })]
        : []
      return { data: { action: 'file_download', response, localFiles } }
    }
    const response = await minimaxJSON({
      path: '/v1/files/delete',
      body: { file_id: input.file_id },
    })
    return { data: { action: 'file_delete', response } }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return toolResult(toolUseID, output)
  },
} satisfies ToolDef<FileInputSchema, MiniMaxToolOutput>)

export const MiniMaxQuotaTool = buildTool({
  name: 'MiniMaxQuota',
  searchHint: 'query MiniMax token plan quota',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Query MiniMax Token Plan or quota status.'
  },
  async prompt() {
    return 'Use this read-only tool to query MiniMax Token Plan remains/quota status.'
  },
  get inputSchema(): QuotaInputSchema {
    return quotaInputSchema()
  },
  get outputSchema() {
    return outputSchema()
  },
  isReadOnly() {
    return true
  },
  isConcurrencySafe() {
    return true
  },
  renderToolUseMessage() {
    return 'MiniMax quota'
  },
  async call() {
    const response = await minimaxJSON({
      baseURL: 'https://www.minimaxi.com',
      path: '/v1/token_plan/remains',
      method: 'GET',
    })
    return { data: { action: 'quota', response } }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return toolResult(toolUseID, output)
  },
} satisfies ToolDef<QuotaInputSchema, MiniMaxToolOutput>)

export const MiniMaxTools = [
  MiniMaxImageTool,
  MiniMaxSpeechTool,
  MiniMaxVideoTool,
  MiniMaxMusicTool,
  MiniMaxVisionTool,
  MiniMaxFileTool,
  MiniMaxQuotaTool,
]

function toolResult(toolUseID: string, output: MiniMaxToolOutput) {
  return {
    tool_use_id: toolUseID,
    type: 'tool_result' as const,
    content: artifactSummary(output.response, output.localFiles),
  }
}

async function checkOutputPathPermission(
  toolRef: { getPath(input: Record<string, unknown>): string; name: string },
  input: Record<string, unknown> & { output_path?: string },
  context: ToolUseContext,
): Promise<PermissionDecision> {
  if (!input.output_path) {
    return { behavior: 'allow', updatedInput: input }
  }
  const fullPath = expandPath(input.output_path)
  if (existsSync(fullPath)) {
    return {
      behavior: 'ask',
      message: `MiniMax output would overwrite ${fullPath}.`,
    }
  }
  return checkWritePermissionForTool(
    toolRef as Parameters<typeof checkWritePermissionForTool>[0],
    { ...input, output_path: fullPath },
    context.getAppState().toolPermissionContext,
  )
}

async function saveImageOutputs(
  response: MiniMaxJSON,
  outputPath?: string,
): Promise<string[]> {
  const data = response.data as { image_base64?: string[]; image_urls?: string[] } | undefined
  if (data?.image_base64?.length) {
    return saveBase64Artifacts({
      values: data.image_base64,
      outputPath,
      subdir: 'images',
      extension: '.png',
    })
  }
  return []
}

async function saveAudioOutputs(
  response: MiniMaxJSON,
  outputPath: string | undefined,
  format: string,
): Promise<string[]> {
  const data = response.data as { audio?: string; audio_url?: string } | undefined
  if (data?.audio) {
    return [
      await saveHexArtifact({
        value: data.audio,
        outputPath,
        subdir: 'audio',
        extension: `.${format}`,
      }),
    ]
  }
  if (data?.audio_url) {
    return [
      await downloadToArtifact({
        url: data.audio_url,
        outputPath,
        subdir: 'audio',
        extension: `.${format}`,
      }),
    ]
  }
  return []
}

function extractDownloadURL(response: MiniMaxJSON): string | null {
  const file = response.file as { download_url?: unknown } | undefined
  return typeof file?.download_url === 'string' ? file.download_url : null
}

function requireField(value: unknown, field: string): asserts value {
  if (value === undefined || value === null || value === '') {
    throw new Error(`${field} is required for this MiniMax action`)
  }
}

function stripUndefined(input: MiniMaxJSON): MiniMaxJSON {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  )
}
