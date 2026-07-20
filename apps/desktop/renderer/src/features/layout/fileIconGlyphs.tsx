import type React from 'react'
import type { FileIconKind } from './fileIconKind.js'

type CustomFileIconKind = Exclude<FileIconKind, 'file' | 'code'>

export type FileIconGlyphProps = Omit<
  React.SVGProps<SVGSVGElement>,
  'height' | 'width'
> & {
  kind: CustomFileIconKind
  size?: number | string
}

const STROKE_WIDTH = 1.2

export function FileIconGlyph({
  kind,
  size = 16,
  className,
  ...props
}: FileIconGlyphProps): React.ReactNode {
  return (
    <svg
      {...props}
      className={`file-type-icon file-type-icon--${kind}${className ? ` ${className}` : ''}`}
      data-file-icon-kind={kind}
      fill="none"
      height={size}
      viewBox="0 0 16 16"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      {fileIconGlyph(kind)}
    </svg>
  )
}

function fileIconGlyph(kind: CustomFileIconKind): React.ReactNode {
  switch (kind) {
    case 'typescript':
      return (
        <>
          <Badge />
          <path
            d="M3.7 5.3h3.7M5.55 5.3v5.4M8.45 9.85c.45.52 1.02.78 1.7.78.77 0 1.25-.35 1.25-.9 0-.56-.45-.76-1.24-.96-.95-.24-1.48-.7-1.48-1.48 0-.86.7-1.5 1.76-1.5.68 0 1.24.2 1.69.62"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={STROKE_WIDTH}
          />
        </>
      )
    case 'javascript':
      return (
        <>
          <Badge />
          <path
            d="M6.65 5.35v3.9c0 .9-.43 1.4-1.25 1.4-.58 0-1-.22-1.3-.68M8.45 9.85c.45.52 1.02.78 1.7.78.77 0 1.25-.35 1.25-.9 0-.56-.45-.76-1.24-.96-.95-.24-1.48-.7-1.48-1.48 0-.86.7-1.5 1.76-1.5.68 0 1.24.2 1.69.62"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={STROKE_WIDTH}
          />
        </>
      )
    case 'react':
      return (
        <>
          <circle cx="8" cy="8" fill="currentColor" r="1.1" />
          <ellipse
            cx="8"
            cy="8"
            rx="6"
            ry="2.35"
            stroke="currentColor"
            strokeWidth="1"
          />
          <ellipse
            cx="8"
            cy="8"
            rx="6"
            ry="2.35"
            stroke="currentColor"
            strokeWidth="1"
            transform="rotate(60 8 8)"
          />
          <ellipse
            cx="8"
            cy="8"
            rx="6"
            ry="2.35"
            stroke="currentColor"
            strokeWidth="1"
            transform="rotate(120 8 8)"
          />
        </>
      )
    case 'json':
      return (
        <path
          d="M6.45 2.25c-1.15 0-1.75.58-1.75 1.72v2.1c0 .8-.4 1.3-1.2 1.5.8.2 1.2.7 1.2 1.5v2.95c0 1.14.6 1.73 1.75 1.73M9.55 2.25c1.15 0 1.75.58 1.75 1.72v2.1c0 .8.4 1.3 1.2 1.5-.8.2-1.2.7-1.2 1.5v2.95c0 1.14-.6 1.73-1.75 1.73"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.35"
        />
      )
    case 'markdown':
      return (
        <>
          <FileFrame />
          <path
            d="M4.7 10.9V7.3l1.65 1.85L8 7.3v3.6M9.3 9.45l1.15 1.15 1.15-1.15M10.45 7.15v3.35"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1"
          />
        </>
      )
    case 'css':
      return (
        <path
          d="M5.8 2.2 4.65 13.8M10.85 2.2 9.7 13.8M2.75 6.25h10.5M2.3 10h10.5"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.35"
        />
      )
    case 'html':
      return (
        <path
          d="m6.05 4-3.7 4 3.7 4M9.95 4l3.7 4-3.7 4M9.15 2.7 6.85 13.3"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.35"
        />
      )
    case 'python':
      return (
        <>
          <path
            d="M7.85 2.1c-2.5 0-3.3.72-3.3 2.35v1.4h4.7v.8H3.9C2.7 6.65 2 7.55 2 8.65c0 1.15.72 2.2 2.05 2.2h1.2V9.3c0-1.45 1.18-2.55 2.65-2.55h2.15c1.17 0 2.1-.95 2.1-2.12V3.4c0-.85-.72-1.3-1.45-1.3H7.85Z"
            fill="currentColor"
          />
          <path
            d="M8.15 13.9c2.5 0 3.3-.72 3.3-2.35v-1.4h-4.7v-.8h5.35c1.2 0 1.9-.9 1.9-2 0-1.15-.72-2.2-2.05-2.2h-1.2V6.7c0 1.45-1.18 2.55-2.65 2.55H5.95c-1.17 0-2.1.95-2.1 2.12v1.23c0 .85.72 1.3 1.45 1.3h2.85Z"
            fill="currentColor"
            opacity=".62"
          />
        </>
      )
    case 'rust':
      return (
        <>
          <path
            d="M8 1.75 9.05 3l1.55-.45.42 1.56 1.55.42-.45 1.55L13.35 7.1 12.3 8.3l.45 1.55-1.55.42-.42 1.55-1.55-.45L8.2 12.6 7 11.55 5.45 12l-.42-1.55-1.55-.42.45-1.55L2.7 7.45l1.05-1.2-.45-1.55 1.55-.42.42-1.55 1.55.45L8 1.75Z"
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="1"
          />
          <circle cx="8" cy="7.2" r="2.2" stroke="currentColor" />
          <path d="M7 8.5V5.9h1.25c.8 0 1.2.42 1.2 1 0 .62-.45 1-1.2 1H7M8.45 7.9l1.25 1.25" stroke="currentColor" strokeLinecap="round" strokeWidth=".85" />
        </>
      )
    case 'cplusplus':
      return (
        <>
          <path
            d="m8 1.8 5.35 3.08v6.24L8 14.2l-5.35-3.08V4.88L8 1.8Z"
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="1.15"
          />
          <path
            d="M8.1 5.35a2.7 2.7 0 1 0 0 4.9M9.55 6.7h3M11.05 5.2v3M9.55 10.35h3M11.05 8.85v3"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth=".95"
          />
        </>
      )
    case 'java':
      return (
        <>
          <path d="M5 10.35h6.1c0 2-1.1 3-3.05 3S5 12.35 5 10.35Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.15" />
          <path d="M11.1 10.8h.75c1.05 0 1.45.45 1.45 1.05 0 .7-.55 1.05-1.65 1.05h-1.2M6.45 8.9c-1.35-1.45 2.15-1.7.55-3.4M8.55 8.9c-1.55-1.75 2.65-2.1.55-4.35M10.4 8.9c-1.05-1.15 1.65-1.45.5-2.75" stroke="currentColor" strokeLinecap="round" strokeWidth="1" />
        </>
      )
    case 'php':
      return (
        <>
          <ellipse cx="8" cy="8" rx="6.4" ry="4.25" stroke="currentColor" strokeWidth="1.15" />
          <path d="M4.05 9.7 4.8 6.35h1.45c.9 0 1.35.42 1.2 1.15-.15.7-.7 1.05-1.55 1.05H4.3M7.4 9.7l.75-3.35M8 7.65h1.45L9 9.7M9.75 9.7l.75-3.35h1.35c.9 0 1.35.42 1.2 1.15-.15.7-.7 1.05-1.55 1.05h-1.2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth=".8" />
        </>
      )
    case 'shell':
      return (
        <>
          <rect x="1.75" y="2.5" width="12.5" height="11" rx="2" stroke="currentColor" strokeWidth="1.2" />
          <path d="m4.25 6 2.35 2-2.35 2M8.15 10.2h3.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.25" />
        </>
      )
    case 'yaml':
      return (
        <>
          <path d="M4 3.2v4.1M12 3.2v4.1M4 5.2h8M8 5.2v7.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.2" />
          <circle cx="4" cy="2.7" fill="currentColor" r="1.25" />
          <circle cx="12" cy="2.7" fill="currentColor" r="1.25" />
          <circle cx="8" cy="13" fill="currentColor" r="1.25" />
        </>
      )
    case 'toml':
      return (
        <path
          d="M5.7 2.4H3.5v11.2h2.2M10.3 2.4h2.2v11.2h-2.2M6.65 5.1h2.7M8 5.1v5.8"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.25"
        />
      )
    case 'database':
      return (
        <>
          <ellipse cx="8" cy="3.75" rx="5.25" ry="2.05" stroke="currentColor" strokeWidth="1.15" />
          <path d="M2.75 3.75v4.1c0 1.15 2.35 2.05 5.25 2.05s5.25-.9 5.25-2.05v-4.1M2.75 7.85v4.1C2.75 13.1 5.1 14 8 14s5.25-.9 5.25-2.05v-4.1" stroke="currentColor" strokeWidth="1.15" />
        </>
      )
    case 'image':
      return (
        <>
          <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.15" />
          <circle cx="10.75" cy="5.25" fill="currentColor" r="1.25" />
          <path d="m3.6 12 3.15-3.5 2.1 2.1 1.3-1.4 2.3 2.8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.15" />
        </>
      )
    case 'notebook':
      return (
        <>
          <path d="M4 1.75h8.25A1.75 1.75 0 0 1 14 3.5v9A1.75 1.75 0 0 1 12.25 14.25H4V1.75Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.15" />
          <path d="M4 1.75v12.5M1.8 4.4h3.3M1.8 8h3.3M1.8 11.6h3.3M7 5.1h4M7 7.8h4M7 10.5h2.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.05" />
        </>
      )
    case 'pdf':
      return (
        <>
          <FileFrame />
          <path d="M4.45 10.9V7.2h1.3c.85 0 1.35.45 1.35 1.15 0 .75-.5 1.2-1.35 1.2h-1.3M8 7.2v3.7h1c1.25 0 2-.7 2-1.85S10.25 7.2 9 7.2H8M11.75 10.9V7.2h2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth=".8" />
        </>
      )
    case 'spreadsheet':
      return (
        <>
          <rect x="2" y="2" width="12" height="12" rx="1.8" stroke="currentColor" strokeWidth="1.15" />
          <path d="M2 6h12M2 10h12M6 2v12M10 2v12" stroke="currentColor" strokeWidth="1" />
          <rect x="2.6" y="2.6" width="2.8" height="2.8" rx=".4" fill="currentColor" />
        </>
      )
    case 'presentation':
      return (
        <>
          <rect x="2" y="2.25" width="12" height="9" rx="1.6" stroke="currentColor" strokeWidth="1.15" />
          <path d="M8 11.25v2.5M5.65 13.75h4.7M8 4.2v3.1h3.1" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.1" />
          <path d="M8 7.3 5.8 9a3.1 3.1 0 0 1-.9-2.2c0-1.7 1.38-3.1 3.1-3.1v3.6Z" fill="currentColor" opacity=".35" />
        </>
      )
    case 'document':
      return (
        <>
          <FileFrame />
          <path d="M4.75 7h6.5M4.75 9.25h6.5M4.75 11.5h4.2" stroke="currentColor" strokeLinecap="round" strokeWidth="1.05" />
        </>
      )
    case 'archive':
      return (
        <>
          <path d="M2.25 4.7h11.5v8.15c0 .75-.6 1.35-1.35 1.35H3.6c-.75 0-1.35-.6-1.35-1.35V4.7Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.15" />
          <path d="M1.6 2.05h12.8v2.7H1.6zM6.2 7.3h3.6M6.2 9.25h3.6" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.15" />
        </>
      )
    case 'build':
      return (
        <>
          <path d="m8 1.65 5.45 3.1v6.5L8 14.35l-5.45-3.1v-6.5L8 1.65Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.1" />
          <path d="m2.9 4.95 5.1 3 5.1-3M8 8v5.85M5.25 3.25 10.5 6.3" stroke="currentColor" strokeLinejoin="round" strokeWidth="1" />
        </>
      )
    case 'skill':
      return (
        <>
          <FileFrame />
          <path d="m8.1 6.4.55 1.55 1.55.55-1.55.55-.55 1.55-.55-1.55L6 8.5l1.55-.55.55-1.55ZM11.65 4l.3.85.85.3-.85.3-.3.85-.3-.85-.85-.3.85-.3.3-.85Z" fill="currentColor" stroke="currentColor" strokeLinejoin="round" strokeWidth=".35" />
        </>
      )
  }
}

function Badge(): React.ReactNode {
  return (
    <rect
      x="1.75"
      y="1.75"
      width="12.5"
      height="12.5"
      rx="2.35"
      fill="currentColor"
      fillOpacity=".1"
      stroke="currentColor"
      strokeWidth="1.1"
    />
  )
}

function FileFrame(): React.ReactNode {
  return (
    <>
      <path
        d="M3.25 2.55c0-.58.47-1.05 1.05-1.05h4.85l3.6 3.6v8.35c0 .58-.47 1.05-1.05 1.05H4.3c-.58 0-1.05-.47-1.05-1.05V2.55Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.15"
      />
      <path
        d="M9.15 1.65V5.1h3.45"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.15"
      />
    </>
  )
}
