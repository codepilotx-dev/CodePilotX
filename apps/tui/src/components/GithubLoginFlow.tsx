/**
 * GitHub device-authorization login flow for the TUI.
 *
 * Renders the device code and verification URL, polls GitHub for
 * authorization, then exchanges the token for a CodePilotX app token.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Box, Link, Text } from '../ink.js'
import { useKeybinding } from '../keybindings/useKeybinding.js'
import { setClipboard } from '../ink/termio/osc.js'
import {
  type GithubDeviceFlowState,
  startGithubDeviceFlow,
  pollGithubDeviceFlow,
} from '../services/oauth/githubDeviceFlow.js'
import { Spinner } from './Spinner.js'

type Props = {
  onDone(): void
  startingMessage?: string
}

export function GithubLoginFlow({
  onDone,
  startingMessage,
}: Props): React.ReactNode {
  const [flowState, setFlowState] = useState<GithubDeviceFlowState>({
    phase: 'idle',
  })
  const [copied, setCopied] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const stateRef = useRef<GithubDeviceFlowState>(flowState)

  // Keep ref in sync
  stateRef.current = flowState

  // Start the flow on mount
  useEffect(() => {
    if (flowState.phase === 'idle') {
      startGithubDeviceFlow().then(setFlowState)
    }
  }, [flowState.phase])

  // Start polling when we have the device code
  useEffect(() => {
    if (flowState.phase === 'awaiting_device_code') {
      intervalRef.current = setInterval(async () => {
        if (stateRef.current.phase === 'awaiting_device_code') {
          const next = await pollGithubDeviceFlow(stateRef.current)
          setFlowState(next)

          // Auto-advance on completion
          if (next.phase === 'completed') {
            if (intervalRef.current) clearInterval(intervalRef.current)
          }
          if (next.phase === 'failed') {
            if (intervalRef.current) clearInterval(intervalRef.current)
          }
        }
      }, 1000) // Poll every second, the flow handles minimum interval
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [flowState.phase])

  // Handle completed state — auto-proceed
  useEffect(() => {
    if (flowState.phase === 'completed') {
      const timer = setTimeout(() => onDone(), 1500)
      return () => clearTimeout(timer)
    }
  }, [flowState.phase, onDone])

  // Copy user code to clipboard
  const handleCopy = useCallback(() => {
    if (
      flowState.phase === 'awaiting_device_code'
    ) {
      void setClipboard(flowState.userCode).then(() => setCopied(true))
    }
  }, [flowState])

  // Handle retry on failure
  const handleRetry = useCallback(() => {
    setFlowState({ phase: 'idle' })
  }, [])

  // Render

  if (flowState.phase === 'idle') {
    return (
      <Box flexDirection="column" gap={1} paddingBottom={1}>
        {startingMessage && <Text>{startingMessage}</Text>}
        <Spinner message="正在启动 GitHub 登录..." />
      </Box>
    )
  }

  if (flowState.phase === 'failed') {
    return (
      <Box flexDirection="column" gap={1} paddingBottom={1}>
        <Text color="red">GitHub 登录失败</Text>
        <Text dimColor>{flowState.error}</Text>
        <Text>
          按 <Text color="cyan">r</Text> 重试，或按{' '}
          <Text color="cyan">Esc</Text> 取消
        </Text>
      </Box>
    )
  }

  if (flowState.phase === 'completed') {
    return (
      <Box flexDirection="column" gap={1} paddingBottom={1}>
        <Text color="green">✓ {flowState.message}</Text>
      </Box>
    )
  }

  if (flowState.phase === 'awaiting_device_code') {
    useKeybinding('r', handleCopy)
    return (
      <Box flexDirection="column" gap={1} paddingBottom={1}>
        <Text bold>GitHub 登录</Text>

        <Box flexDirection="column" gap={0}>
          <Text>请使用以下设备码在 GitHub 上授权：</Text>
          <Box paddingLeft={2} paddingY={1}>
            <Text bold color="cyan">
              {flowState.userCode}
            </Text>
          </Box>
        </Box>

        <Box flexDirection="column" gap={0}>
          <Text>或在浏览器中打开：</Text>
          <Link url={flowState.verificationUri}>
            <Text color="blue" underline>
              {flowState.verificationUri}
            </Text>
          </Link>
        </Box>

        <Box paddingTop={1}>
          {copied ? (
            <Text color="green">✓ 已复制到剪贴板</Text>
          ) : (
            <Text>
              按 <Text color="cyan">c</Text> 复制设备码
            </Text>
          )}
        </Box>

        <Box paddingTop={1}>
          <Spinner message="等待 GitHub 授权..." />
        </Box>
      </Box>
    )
  }

  // Fallback / exchanging
  return (
    <Box flexDirection="column" gap={1} paddingBottom={1}>
      <Spinner message="正在交换令牌..." />
    </Box>
  )
}
