import type { NewSessionSuggestionCategoryId } from "./newSessionSuggestions.js";

export type NewSessionSuggestionState =
  | { kind: "root" }
  | { kind: "category"; categoryId: NewSessionSuggestionCategoryId }
  | { kind: "hidden"; reason: "custom-input" };

export function createNewSessionSuggestionState(
  composerValue: string,
): NewSessionSuggestionState {
  return composerValue.trim().length > 0
    ? { kind: "hidden", reason: "custom-input" }
    : { kind: "root" };
}

export function syncNewSessionSuggestionState(
  state: NewSessionSuggestionState,
  composerValue: string,
): NewSessionSuggestionState {
  if (state.kind === "category") return state;
  return createNewSessionSuggestionState(composerValue);
}

export function selectNewSessionSuggestionCategory(
  categoryId: NewSessionSuggestionCategoryId,
): NewSessionSuggestionState {
  return { kind: "category", categoryId };
}

export function removeGeneratedSuggestionStarter(
  composerValue: string,
  starter: string,
): string {
  if (!composerValue.startsWith(starter)) return composerValue;
  return composerValue.slice(starter.length).trimStart();
}
