export type PromptCacheCapability =
  | { provider: "openai"; strategy: "prompt-cache-key" }
  | { provider: "anthropic"; strategy: "explicit-ephemeral"; maxBreakpoints: 4 }
  | { provider: "other"; strategy: "stable-prefix" };

/** UI diagnostic only. Pi owns provider cache options at the Harness boundary. */
export const inferPromptCacheCapability = (
  providerID: string,
): PromptCacheCapability => {
  const normalized = providerID.trim().toLowerCase();
  if (/^openai(?:\.|$)/.test(normalized))
    return { provider: "openai", strategy: "prompt-cache-key" };
  if (/^anthropic(?:\.|$)/.test(normalized))
    return {
      provider: "anthropic",
      strategy: "explicit-ephemeral",
      maxBreakpoints: 4,
    };
  return { provider: "other", strategy: "stable-prefix" };
};
