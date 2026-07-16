import type React from "react";
import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  CornerDownLeft,
  Pencil,
} from "lucide-react";
import type { DesktopPermissionRequest } from "../../../shared/types.js";
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from "../../components/ui/iconTokens.js";
import { buildPopoverSizingStyle } from "../../components/ui/popoverSizing.js";
import {
  useQuickChatContext,
  type ProviderModelOption,
} from "./QuickChatContext.js";

export type ExitPlanModeApprovalProps = {
  request: DesktopPermissionRequest;
  onAccept: (options?: {
    note?: string;
    planExecutionModel?: string;
    planExecutionProviderID?: string;
    planExecutionProviderBaseURL?: string;
    savePlanExecutionModel?: boolean;
  }) => void;
  onRevise: () => void;
};

export function ExitPlanModeApproval({
  onAccept,
  onRevise,
}: ExitPlanModeApprovalProps): React.ReactNode {
  const { providerModelOptions } = useQuickChatContext();
  const [note, setNote] = useState("");
  const [selectedProviderID, setSelectedProviderID] = useState("");
  const [selectedModelValue, setSelectedModelValue] = useState("");
  const [selectedProviderBaseURL, setSelectedProviderBaseURL] = useState<
    string | undefined
  >(undefined);
  const [savePlanExecutionModel, setSavePlanExecutionModel] = useState(false);

  const selectedLabel = deriveSelectedLabel(
    selectedProviderID,
    selectedModelValue,
    providerModelOptions,
  );

  function handleProviderModelSelect(
    providerID: string,
    modelValue: string,
    baseURL: string | undefined,
  ): void {
    setSelectedProviderID(providerID);
    setSelectedModelValue(modelValue);
    setSelectedProviderBaseURL(baseURL);
  }

  function handleAccept(): void {
    onAccept({
      note: note.trim() || undefined,
      planExecutionProviderID: selectedProviderID || undefined,
      planExecutionModel: selectedModelValue || undefined,
      planExecutionProviderBaseURL: selectedProviderBaseURL,
      savePlanExecutionModel,
    });
  }

  return (
    <div className="exit-plan-mode-approval">
      <div className="exit-plan-mode-title-row">
        <p className="exit-plan-mode-title">实施此计划?</p>
        <label className="exit-plan-mode-model">
          <span>使用</span>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                aria-label="计划执行模型"
                className="chip-button subtle composer-model-chip exit-plan-mode-model-trigger"
                title="计划执行模型"
                type="button"
              >
                <span className="permission-select-trigger-label composer-model-chip-label">
                  {selectedLabel}
                </span>
                <ChevronDown
                  size={APP_ICON_SIZE}
                  strokeWidth={APP_ICON_STROKE_WIDTH}
                />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="start"
                className="popover-surface rm-model-menu exit-plan-mode-model-content"
                collisionPadding={12}
                side="bottom"
                sideOffset={6}
                style={buildPopoverSizingStyle({ width: 200 })}
              >
                <div className="rm-model-menu-scroll-content">
                  <DropdownMenu.Item
                    className="rm-menu-item"
                    onSelect={() => {
                      setSelectedProviderID("");
                      setSelectedModelValue("");
                      setSelectedProviderBaseURL(undefined);
                    }}
                  >
                    <span className="rm-item-label">默认</span>
                    {!selectedProviderID ? (
                      <Check
                        className="rm-item-check"
                        size={APP_ICON_SIZE}
                        strokeWidth={APP_ICON_STROKE_WIDTH}
                      />
                    ) : null}
                  </DropdownMenu.Item>
                  {providerModelOptions.length === 0 ? (
                    <div className="rm-empty">未配置模型</div>
                  ) : (
                    <>
                      <div className="rm-divider" />
                      <div className="rm-section-header">提供商</div>
                      {providerModelOptions.map((provider) => (
                        <DropdownMenu.Sub key={provider.providerID}>
                          <DropdownMenu.SubTrigger
                            className={[
                              "rm-sub-trigger",
                              provider.providerID === selectedProviderID
                                ? "selected"
                                : "",
                            ].join(" ")}
                          >
                            <span className="rm-sub-trigger-content">
                              <span className="rm-item-label">
                                {provider.displayName}
                              </span>
                              {provider.providerID === selectedProviderID ? (
                                <Check
                                  className="rm-item-check rm-provider-check"
                                  size={APP_ICON_SIZE}
                                  strokeWidth={APP_ICON_STROKE_WIDTH}
                                />
                              ) : null}
                            </span>
                            <ChevronRight
                              className="rm-item-arrow"
                              size={APP_ICON_SIZE}
                            />
                          </DropdownMenu.SubTrigger>
                          <DropdownMenu.Portal>
                            <DropdownMenu.SubContent
                              className="popover-surface rm-model-menu rm-model-submenu"
                              alignOffset={-6}
                              sideOffset={8}
                              style={buildPopoverSizingStyle({
                                width: "auto",
                                maxWidth:
                                  "min(calc(320px + var(--popover-width-extra)), calc(100vw - 32px))",
                              })}
                            >
                              <div className="rm-model-submenu-scroll-content">
                                <div className="rm-section-header">模型</div>
                                {provider.modelPresets.map((preset) => (
                                  <DropdownMenu.Item
                                    className="rm-menu-item"
                                    key={preset.id}
                                    onSelect={() => {
                                      handleProviderModelSelect(
                                        provider.providerID,
                                        preset.value,
                                        provider.baseURL,
                                      );
                                    }}
                                  >
                                    <span className="rm-item-label">
                                      {preset.label}
                                    </span>
                                    {provider.providerID ===
                                      selectedProviderID &&
                                    preset.value === selectedModelValue ? (
                                      <Check
                                        className="rm-item-check"
                                        size={APP_ICON_SIZE}
                                        strokeWidth={APP_ICON_STROKE_WIDTH}
                                      />
                                    ) : null}
                                  </DropdownMenu.Item>
                                ))}
                              </div>
                            </DropdownMenu.SubContent>
                          </DropdownMenu.Portal>
                        </DropdownMenu.Sub>
                      ))}
                    </>
                  )}
                </div>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <span>模型</span>
        </label>
      </div>

      <div className="exit-plan-mode-info-row">
        <label className="exit-plan-mode-info">
          <input
            type="checkbox"
            checked={savePlanExecutionModel}
            onChange={(event) =>
              setSavePlanExecutionModel(event.target.checked)
            }
          />
          <span>保存为默认计划执行模型</span>
        </label>
      </div>

      <div className="exit-plan-mode-options">
        <button
          className="exit-plan-mode-option selected"
          type="button"
          onClick={handleAccept}
        >
          <span className="exit-plan-mode-badge">1</span>
          <span className="exit-plan-mode-label">是，实施此计划</span>
          <span className="exit-plan-mode-arrows" aria-hidden="true">
            <ArrowUp size={14} />
            <ArrowDown size={14} />
          </span>
        </button>
      </div>

      <div className="exit-plan-mode-note-row">
        <div className="exit-plan-mode-note-wrap">
          <Pencil
            className="exit-plan-mode-note-icon"
            size={APP_ICON_SIZE}
            strokeWidth={APP_ICON_STROKE_WIDTH}
          />
          <input
            className="exit-plan-mode-note-input"
            placeholder="否，请告知 CodePilotX 如何调整"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
        <div className="exit-plan-mode-actions">
          <button
            className="exit-plan-mode-skip"
            type="button"
            onClick={onRevise}
          >
            <span>忽略</span>
            <kbd>ESC</kbd>
          </button>
          <button
            className="inline-approval-submit exit-plan-mode-submit"
            type="button"
            onClick={handleAccept}
          >
            <span>提交</span>
            <CornerDownLeft size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function deriveSelectedLabel(
  providerID: string,
  modelValue: string,
  providerModelOptions: ProviderModelOption[],
): string {
  if (!providerID || !modelValue) return "默认";
  const provider = providerModelOptions.find(
    (p) => p.providerID === providerID,
  );
  if (!provider) return modelValue;
  const preset = provider.modelPresets.find((p) => p.value === modelValue);
  return preset?.label ?? modelValue;
}

export function extractPlanSummary(request: DesktopPermissionRequest): string {
  const input = request.input ?? {};
  const candidateKeys = ["plan", "planMarkdown", "summary", "content", "text"];
  for (const key of candidateKeys) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return "";
  }
}
