import { expect, test } from 'bun:test'
import { buildCopilotPrompt } from './copilotSdk.js'

test('buildCopilotPrompt rejects image and document attachments explicitly', () => {
  expect(() =>
    buildCopilotPrompt(
      [
        {
          type: 'user',
          message: {
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/png',
                  data: 'aW1hZ2U=',
                },
              },
            ],
          },
        },
      ] as any,
      [],
    ),
  ).toThrow('Image attachments are not supported')

  expect(() =>
    buildCopilotPrompt(
      [
        {
          type: 'user',
          message: {
            content: [
              {
                type: 'document',
                source: {
                  type: 'base64',
                  media_type: 'application/pdf',
                  data: 'cGRm',
                },
              },
            ],
          },
        },
      ] as any,
      [],
    ),
  ).toThrow('Document/PDF attachments are not supported')
})
