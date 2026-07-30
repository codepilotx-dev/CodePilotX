import { createContext, useContext } from "react";

import type { DesktopSessionStatus } from "../../../../shared/types.js";
import type {
  MarkdownFileOpenOptions,
  MarkdownFileReference,
} from "../../markdown/index.js";

export type ConversationItemContextValue = {
  canCopyFileReferenceContents: (
    reference: MarkdownFileReference,
  ) => boolean;
  onCopyFileReferenceContents: (
    reference: MarkdownFileReference,
  ) => void | Promise<void>;
  onOpenFileReference: (
    reference: MarkdownFileReference,
    options: MarkdownFileOpenOptions,
  ) => void;
  onSubmitEditedUserMessage: (text: string) => Promise<void>;
  sessionStatus: DesktopSessionStatus;
  workspacePath: string | null;
};

export const ConversationItemContext =
  createContext<ConversationItemContextValue | null>(null);

export function useConversationItemContext(): ConversationItemContextValue {
  const context = useContext(ConversationItemContext);
  if (!context) {
    throw new Error(
      "useConversationItemContext must be used within ConversationItemContext.Provider",
    );
  }
  return context;
}
