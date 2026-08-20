import { desktopClient } from "../../services/desktop-client/index.js";
import { isExecutableDesktopProvider } from "../../services/desktop-client/provider-adapters.js";
import { withModelCatalogLoading } from "../../hooks/useModelCatalogLoading.js";
import React, { useEffect, useMemo, useState } from "react";
import type {
  DesktopApiKeySummary,
  DesktopModelMetadata,
  DesktopModelProviderState,
  DesktopModelProviderSummary,
  DesktopModelRef,
  ModelProviderID,
} from "../../../shared/types.js";
import { useDesktopSettings } from "../settings/useDesktopSettings.js";
import { fullErrorMessage } from "../../utils/errors.js";
import {
  Cable,
  CircleStop,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Button } from "../../components/ui/Button.js";
import { ConfirmationDialog } from "../../components/ui/ConfirmationDialog.js";
import { SegmentedControl } from "../../components/ui/SegmentedControl.js";
import { SkeletonBlock, SkeletonRegion } from "../../components/ui/Skeleton.js";
import { useSearchParams } from "react-router-dom";
import {
  ProviderCatalog,
  type ProviderCatalogItem,
} from "./ProviderCatalog.js";
import { ProviderDetail } from "./ProviderDetail.js";
import { useModelCenterController } from "./useModelCenterController.js";
import {
  getApiKeyDeleteConfirmation,
  parseModelCenterSearchParams,
  projectProviderDirectory,
  updateModelCenterSearchParams,
  type ProviderCatalogFilter,
} from "./modelCenterState.js";
import { WorkspaceHeaderItem } from "../layout/workspace-header/index.js";
import { ModelHealthWorkspace } from "./health/ModelHealthWorkspace.js";
import { useModelHealthController } from "./health/useModelHealthController.js";
import { ProviderConnectionDialog } from "./provider-management/ProviderConnectionDialog.js";
import { ProviderEditorDialog } from "./provider-management/ProviderEditorDialog.js";
import { ProviderConnectionSection } from "./provider-management/ProviderConnectionSection.js";
import { ProviderModelsSection } from "./provider-management/ProviderModelsSection.js";
import {
  ApiKeyEditorDialog,
  type ApiKeyEditorValue,
} from "./ApiKeyEditorDialog.js";
import {
  providerManagementStore,
  selectConfiguredProviderGroups,
  type ConfiguredProviderGroup,
} from "../provider-management/index.js";

const NO_MODEL_OPTION = "__no_models_available__";

type Props = {
  onError: (message: string) => void;
  onNotice: (message: string) => void;
};

export function getProviderSelectionState(
  provider: DesktopModelProviderSummary | undefined,
): { model: string } {
  return {
    model: provider?.defaultModels[0] ?? "",
  };
}

export function getProviderConnectionState({
  provider,
  model,
  providerModels,
}: {
  provider: DesktopModelProviderSummary | undefined;
  model: string;
  providerModels: string[];
}): { model: string } {
  const defaultSelection = getProviderSelectionState(provider);
  return {
    model: providerModels.includes(model) ? model : defaultSelection.model,
  };
}

export function ModelCenterWorkbench({
  onError,
  onNotice,
}: Props): React.ReactNode {
  const settings = useDesktopSettings();
  const [searchParams, setSearchParams] = useSearchParams();
  const [providerID, setProviderID] = useState<ModelProviderID>(
    settings.providerID,
  );
  const [model, setModel] = useState(settings.model);
  const [variant, setVariant] = useState("");
  const [, setModelError] = useState<string | null>(null);
  const [, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyKeyId, setBusyKeyId] = useState<string | null>(null);
  const [providerSearch, setProviderSearch] = useState("");
  const [catalogFilter, setCatalogFilter] = useState<ProviderCatalogFilter>("all");
  const [connectionDialogProviderId, setConnectionDialogProviderId] =
    useState<ModelProviderID | null>(null);
  const [providerEditorOpen, setProviderEditorOpen] = useState(false);
  const [providerEditorProviderId, setProviderEditorProviderId] =
    useState<ModelProviderID | null>(null);

  // Key editing & deletion state
  const [editorProviderId, setEditorProviderId] = useState<ModelProviderID | null>(null);
  const [editingKey, setEditingKey] = useState<DesktopApiKeySummary | null>(null);
  const [deleteKey, setDeleteKey] = useState<DesktopApiKeySummary | null>(null);

  const controller = useModelCenterController({
    onInitialProviderState: (nextState) => applyProviderState(nextState),
    onError: (message) => {
      setModelError(message);
      onError(message);
    },
  });

  const {
    initialLoadState,
    providers,
    providerState,
    apiKeys,
    snapshot,
    supportsModelHealth,
    setProviderState,
  } = controller;

  const configuredGroups = useMemo(
    () => selectConfiguredProviderGroups(snapshot),
    [snapshot],
  );
  const configuredProviderIds = useMemo(
    () => new Set(configuredGroups.map((group) => group.provider.providerID)),
    [configuredGroups],
  );
  const configuredGroupByProvider = useMemo(
    () =>
      new Map(
        configuredGroups.map((group) => [group.provider.providerID, group]),
      ),
    [configuredGroups],
  );

  const routeState = useMemo(
    () =>
      parseModelCenterSearchParams(
        searchParams,
        providers.map((provider) => provider.providerID),
        providerID,
        { supportsModelHealth: supportsModelHealth ?? false },
      ),
    [providerID, providers, searchParams, supportsModelHealth],
  );

  const workspaceView = routeState.view;
  const health = useModelHealthController(workspaceView === "health");
  const providerSection = routeState.section;

  const healthRunActive =
    health.state.run !== null &&
    (health.state.run.status === "running" ||
      health.state.run.status === "cancelling");

  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.providerID === providerID),
    [providerID, providers],
  );

  const selectedProviderState =
    providerState?.selectedProviderID === providerID ? providerState : null;

  const providerModels = (
    selectedProviderState?.models ??
    selectedProvider?.defaultModels ??
    []
  ).filter((item) => item && item !== NO_MODEL_OPTION);

  const modelMetadata =
    selectedProviderState?.modelMetadata ??
    selectedProvider?.modelMetadata ??
    {};

  const providerApiKeys = useMemo(
    () =>
      apiKeys
        .filter((key) => key.providerId === providerID)
        .sort((left, right) => left.priority - right.priority),
    [apiKeys, providerID],
  );

  const providerDirectory = useMemo(
    () =>
      projectProviderDirectory(
        [...providers].sort((left, right) =>
          left.displayName.localeCompare(right.displayName, "zh-CN", {
            numeric: true,
            sensitivity: "base",
          }),
        ),
        {
          query: providerSearch,
          filter: catalogFilter,
          currentProviderId: providerState?.selectedProviderID,
          currentProviderState: providerState,
          apiKeys,
          credentials: snapshot.credentials,
        },
      ),
    [apiKeys, catalogFilter, providerSearch, providerState, providers, snapshot.credentials],
  );

  const providerCatalogItems = useMemo<ProviderCatalogItem[]>(
    () =>
      providerDirectory.map((item) => {
        const { connectionStatus, current, provider, sources, keyCount, hasOAuth, healthTone } = item;
        const effectiveConnectionStatus =
          connectionStatus === "unconfigured" &&
          configuredProviderIds.has(provider.providerID)
            ? "configured"
            : connectionStatus;
        const displayedStatus = providerCatalogConnectionStatus(
          effectiveConnectionStatus,
          configuredGroupByProvider.get(provider.providerID),
        );
        const unavailableReason = provider.availability?.status === "unavailable"
          ? providerAvailabilityLabel(provider.availability.reason)
          : null;
        return {
          id: provider.providerID,
          name: provider.displayName,
          logoURL: provider.logoURL,
          source: sources
            .map((source) =>
              source === "gateway"
                ? "Gateway"
                : source === "custom"
                  ? "自定义"
                  : source === "models-dev"
                    ? provider.providerKind === "models-dev"
                      ? "models.dev · OpenAI 兼容"
                      : "Pi 原生执行 · models.dev 目录"
                    : "Pi 内置",
            )
            .join(" + "),
          modelCount: provider.modelCount ?? provider.defaultModels.length,
          current,
          canAddConnection: unavailableReason === null
            && effectiveConnectionStatus === "unconfigured",
          connectionDisabled: unavailableReason !== null,
          keyCount,
          hasOAuth,
          healthTone,
          status: unavailableReason
            ? { label: unavailableReason, tone: "warning" }
            : provider.unresolvedMigrationIssues?.length
            ? { label: "需要人工修复", tone: "danger" }
            : displayedStatus,
        };
      }),
    [configuredGroupByProvider, configuredProviderIds, providerDirectory],
  );

  const catalogSourceLabel = useMemo(
    () => catalogSourceStatusLabel(
      providers.find(provider => provider.catalogSource)?.catalogSource,
    ),
    [providers],
  );

  useEffect(() => {
    if (providerID === providerState?.selectedProviderID) return;
    const nextSelection = getProviderSelectionState(selectedProvider);
    setModel(nextSelection.model);
    setVariant("");
    setStatus(null);
    setModelError(null);
  }, [providerID, providerState, selectedProvider]);

  useEffect(() => {
    if (providers.length === 0 || !routeState.providerId) return;
    const requestedProvider = providers.find(
      (provider) => provider.providerID === routeState.providerId,
    );
    if (requestedProvider && requestedProvider.providerID !== providerID) {
      applyProviderSelection(requestedProvider.providerID, requestedProvider);
    }
  }, [providerID, providers, routeState.providerId]);

  useEffect(() => {
    if (
      supportsModelHealth === false &&
      searchParams.get("view") === "health"
    ) {
      updateLocation(
        { view: "providers", provider: null, section: null },
        true,
      );
    }
  }, [searchParams, supportsModelHealth]);

  function updateLocation(
    patch: {
      view?: "providers" | "health";
      provider?: string | null;
      section?: "connection" | "models" | null;
    },
    replace = false,
  ): void {
    setSearchParams(
      (current) => {
        return updateModelCenterSearchParams(current, {
          view: patch.view,
          providerId: patch.provider,
          section: patch.section,
        });
      },
      { replace },
    );
  }

  function selectProvider(nextProviderID: ModelProviderID): void {
    const nextProvider = providers.find(
      (provider) => provider.providerID === nextProviderID,
    );
    applyProviderSelection(nextProviderID, nextProvider);
    updateLocation({ provider: nextProviderID, section: "connection" });
  }

  function showProviderCatalog(): void {
    updateLocation({ provider: null, section: null });
  }

  function applyProviderSelection(
    nextProviderID: ModelProviderID,
    nextProvider: DesktopModelProviderSummary | undefined,
  ): void {
    const nextSelection = getProviderSelectionState(nextProvider);
    setProviderID(nextProviderID);
    setModel(nextSelection.model);
    setVariant("");
    setStatus(null);
    setModelError(null);
  }

  function applyProviderState(
    nextState: DesktopModelProviderState,
  ): void {
    const nextModel =
      nextState.model ||
      nextState.models[0] ||
      nextState.provider.defaultModels[0] ||
      "";
    setProviderState(nextState);
    setProviderID(nextState.selectedProviderID);
    setModel(nextModel);
    setVariant(nextState.variant ?? "");
  }

  function applyFetchedModels(
    models: string[],
    error?: string,
    fetchedMetadata?: Record<string, DesktopModelMetadata>,
  ): void {
    const cleanModels = models.filter(Boolean);
    setProviderState((current) => {
      if (current && current.selectedProviderID === providerID) {
        return {
          ...current,
          models: cleanModels,
          modelMetadata: { ...current.modelMetadata, ...fetchedMetadata },
          error,
        };
      }
      if (!selectedProvider) return current;
      return {
        selectedProviderID: providerID,
        provider: selectedProvider,
        model,
        apiKeyConfigured: false,
        apiKeySource: null,
        modelConfigured: false,
        configurationMessage: "未配置模型，请先在设置中配置模型。",
        models: cleanModels,
        modelMetadata: { ...modelMetadata, ...fetchedMetadata },
        error,
      };
    });
    if (!model && cleanModels[0]) setModel(cleanModels[0]);
  }

  async function fetchModels(): Promise<void> {
    if (!selectedProvider || !isExecutableDesktopProvider(selectedProvider)) {
      onError("此 Provider 当前没有可执行模型，无法刷新目录。");
      return;
    }
    setBusy(true);
    setModelError(null);
    onNotice("正在从供应商刷新模型目录...");
    try {
      const result = await withModelCatalogLoading(() =>
        desktopClient.fetchProviderModels({
          providerID,
        }),
      );
      applyFetchedModels(result.models, result.error, result.modelMetadata);
      if (result.error) {
        onError(`模型目录刷新异常：${result.error}`);
      } else {
        onNotice(`模型目录已同步，共加载 ${result.models.length} 个可用模型。`);
      }
    } catch (error) {
      showOperationError(error);
    } finally {
      setBusy(false);
    }
  }

  async function testConnection(): Promise<void> {
    if (!selectedProvider || !isExecutableDesktopProvider(selectedProvider)) {
      onError("此 Provider 的协议尚未适配，无法测试连接。");
      return;
    }
    setBusy(true);
    setModelError(null);
    onNotice("正在测试连接与鉴权有效性...");
    try {
      const testRef: DesktopModelRef | undefined = model
        ? ({
            providerID,
            id: model,
            ...(variant ? { variant } : {}),
          } as DesktopModelRef)
        : undefined;
      const testResult = await desktopClient.testModelProvider(
        providerID,
        testRef,
      );
      if (testResult.status === "reachable") {
        onNotice(
          `“${selectedProvider?.displayName ?? providerID}”连接正常（响应延迟 ${testResult.latencyMs} ms）。`,
        );
      } else {
        const msg = testResult.message ?? "连接测试失败。";
        setModelError(msg);
        onError(`连接测试失败：${msg}`);
      }
    } catch (error) {
      showOperationError(error);
    } finally {
      setBusy(false);
    }
  }

  async function mutateKey(
    id: string,
    action: () => Promise<unknown>,
    successMessage: string,
  ): Promise<boolean> {
    setBusyKeyId(id);
    try {
      await action();
      onNotice(successMessage);
      window.dispatchEvent(new Event("desktop:model-provider-changed"));
      return true;
    } catch (error) {
      onError(fullErrorMessage(error));
      return false;
    } finally {
      setBusyKeyId(null);
    }
  }

  async function saveApiKeyEditor(value: ApiKeyEditorValue): Promise<boolean> {
    if (editingKey) {
      const replacement = value.key?.trim();
      return mutateKey(
        editingKey.id,
        () =>
          providerManagementStore.updateApiKey({
            credentialId: editingKey.id,
            ...(value.label !== editingKey.label ? { label: value.label } : {}),
            ...(replacement ? { key: replacement } : {}),
          }),
        replacement
          ? "API Key 已更换，健康状态已重置。"
          : "API Key 名称已更新。",
      );
    }
    if (!value.key) return false;
    return mutateKey(
      "create",
      () =>
        providerManagementStore.createApiKey({
          providerId: value.providerId,
          label: value.label,
          key: value.key,
        }),
      "API Key 已安全保存。",
    );
  }

  async function moveApiKey(
    key: DesktopApiKeySummary,
    offset: -1 | 1,
  ): Promise<void> {
    const providerKeys = [...providerApiKeys];
    const index = providerKeys.findIndex((item) => item.id === key.id);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= providerKeys.length) return;
    const [item] = providerKeys.splice(index, 1);
    if (!item) return;
    providerKeys.splice(target, 0, item);
    await mutateKey(
      key.id,
      () =>
        providerManagementStore.reorderApiKeys(
          key.providerId,
          providerKeys.map((candidate) => candidate.id),
        ),
      "API Key 优先级顺序已更新。",
    );
  }

  async function copyApiKey(key: DesktopApiKeySummary): Promise<void> {
    setBusyKeyId(key.id);
    try {
      const result = await desktopClient.copyProviderApiKey(key.id);
      onNotice(
        `API Key 已复制到剪贴板，将在 ${Math.round(result.clearAfterMs / 1000)} 秒后自动清理。`,
      );
    } catch (error) {
      onError(fullErrorMessage(error));
    } finally {
      setBusyKeyId(null);
    }
  }

  async function testSingleApiKey(key: DesktopApiKeySummary): Promise<void> {
    setBusyKeyId(key.id);
    try {
      const result = await providerManagementStore.testApiKey(key.id);
      onNotice(
        result.message ??
          (result.ok ? "API Key 鉴权通过，测试成功。" : "API Key 测试失败。"),
      );
      window.dispatchEvent(new Event("desktop:model-provider-changed"));
    } catch (error) {
      onError(
        error instanceof Error ? error.message : "API Key 测试失败，请稍后重试。",
      );
    } finally {
      setBusyKeyId(null);
    }
  }

  async function createProviderConnection(
    value: ApiKeyEditorValue,
  ): Promise<boolean> {
    if (!value.key) return false;
    setBusy(true);
    try {
      await providerManagementStore.createApiKey({
        providerId: value.providerId,
        label: value.label,
        key: value.key,
      });
      onNotice("供应商连接与凭据已保存。");
      setConnectionDialogProviderId(null);
      updateLocation({ provider: value.providerId, section: "connection" });
      window.dispatchEvent(new Event("desktop:model-provider-changed"));
      return true;
    } catch (error) {
      showOperationError(error);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function showOperationError(error: unknown): void {
    const message = fullErrorMessage(error);
    setModelError(message);
    onError(message);
  }

  async function deleteCustomProvider(): Promise<void> {
    if (!selectedProvider || selectedProvider.providerKind !== "custom") return;
    if (
      !window.confirm(
        `确定删除自定义供应商“${selectedProvider.displayName}”？历史会话引用与已保存凭据将保留。`,
      )
    )
      return;
    setBusy(true);
    try {
      await desktopClient.deleteProvider(selectedProvider.providerID);
      await providerManagementStore.refresh();
      showProviderCatalog();
      onNotice("自定义供应商已删除。");
    } catch (error) {
      showOperationError(error);
    } finally {
      setBusy(false);
    }
  }

  const showingProviderDetail =
    workspaceView === "providers" && routeState.providerId !== null;

  const showInitialSkeleton =
    initialLoadState === "loading" && providers.length === 0;

  const selectedConfiguredGroup = configuredGroups.find(
    (group) => group.provider.providerID === providerID,
  );

  const connectionDialogProvider = connectionDialogProviderId
    ? (providers.find(
        (provider) => provider.providerID === connectionDialogProviderId,
      ) ?? null)
    : null;

  const connectionDialogSources = snapshot.usageSources.filter((source) =>
    source.providerIds.some(
      (pId) => String(pId) === String(connectionDialogProviderId),
    ),
  );

  const editorProvider = editorProviderId
    ? snapshot.providers.find((p) => p.providerID === editorProviderId)
    : undefined;

  const deleteConfirmation = deleteKey
    ? getApiKeyDeleteConfirmation(
        deleteKey,
        [...snapshot.apiKeys],
        snapshot.providers.find(
          (p) => p.providerID === deleteKey.providerId,
        )?.displayName,
      )
    : null;

  return (
    <div className="model-center-shell">
      <WorkspaceHeaderItem align="start" id="models.tabs" order={0} slot="left">
        <SegmentedControl<"providers" | "health">
          ariaLabel="供应商与模型中心工作区"
          className="model-center-workspace-tabs"
          onChange={(view) =>
            updateLocation({ view, provider: null, section: null })
          }
          overflowMode="fit"
          options={[
            {
              value: "providers",
              label: (
                <>
                  供应商 <span>{providers.length}</span>
                </>
              ),
            },
            ...(supportsModelHealth === true
              ? [{ value: "health" as const, label: "全量体检" }]
              : []),
          ]}
          semantics="tabs"
          value={workspaceView}
        />
      </WorkspaceHeaderItem>

      <WorkspaceHeaderItem
        align="end"
        id="models.actions"
        order={100}
        slot="right"
      >
        <div className="model-center-header-actions">
          {!showInitialSkeleton &&
          workspaceView === "health" &&
          supportsModelHealth === true ? (
            <Button
              color="primary"
              disabled={health.busy}
              onClick={() => {
                if (healthRunActive) void health.cancelRun();
                else void health.requestStart();
              }}
            >
              {healthRunActive ? (
                <CircleStop aria-hidden />
              ) : (
                <RefreshCw aria-hidden />
              )}
              <span className="model-center-header-action-label">
                {healthRunActive
                  ? "停止体检"
                  : health.state.run
                    ? "重新体检全部"
                    : "测试全部模型"}
              </span>
            </Button>
          ) : null}

          {!showInitialSkeleton &&
          workspaceView === "providers" &&
          !showingProviderDetail ? (
            <Button
              color="primary"
              onClick={() => {
                setProviderEditorProviderId(null);
                setProviderEditorOpen(true);
              }}
            >
              <Plus aria-hidden />
              <span className="model-center-header-action-label">
                新增自定义 Provider
              </span>
            </Button>
          ) : null}

          {!showInitialSkeleton &&
          showingProviderDetail &&
          selectedProvider?.providerKind === "custom" ? (
            <>
              <Button
                color="secondary"
                onClick={() => {
                  setProviderEditorProviderId(selectedProvider.providerID);
                  setProviderEditorOpen(true);
                }}
              >
                <Pencil aria-hidden />
                <span className="model-center-header-action-label">
                  编辑 Provider
                </span>
              </Button>
              <Button
                color="danger"
                onClick={() => void deleteCustomProvider()}
              >
                <Trash2 aria-hidden />
                <span className="model-center-header-action-label">
                  删除 Provider
                </span>
              </Button>
            </>
          ) : null}

          {!showInitialSkeleton &&
          showingProviderDetail &&
          providerSection === "connection" ? (
            <Button
              color="secondary"
              aria-label="测试连接"
              disabled={busy || !selectedProvider || !isExecutableDesktopProvider(selectedProvider)}
              onClick={() => void testConnection()}
              title="测试当前连接"
            >
              <Cable aria-hidden />
              <span className="model-center-header-action-label">
                测试连接
              </span>
            </Button>
          ) : null}

          {!showInitialSkeleton &&
          showingProviderDetail &&
          providerSection === "models" ? (
            <Button
              color="secondary"
              aria-label="刷新目录"
              disabled={busy || !selectedProvider || !isExecutableDesktopProvider(selectedProvider)}
              onClick={() => void fetchModels()}
              title="刷新模型目录"
            >
              <RefreshCw aria-hidden className={busy ? "spin" : undefined} />
              <span className="model-center-header-action-label">
                刷新目录
              </span>
            </Button>
          ) : null}
        </div>
      </WorkspaceHeaderItem>

      {showInitialSkeleton ? (
        <ModelCenterInitialSkeleton
          view={showingProviderDetail ? "detail" : "catalog"}
          section={providerSection}
        />
      ) : workspaceView === "health" && supportsModelHealth === true ? (
        <ModelHealthWorkspace controller={health} />
      ) : showingProviderDetail && selectedProvider ? (
        <ProviderDetail
          activeTab={providerSection}
          onBack={showProviderCatalog}
          onTabChange={(tab) =>
            updateLocation({ provider: providerID, section: tab })
          }
          provider={{
            id: selectedProvider.providerID,
            name: selectedProvider.displayName,
            logoURL: selectedProvider.logoURL,
            description: providerDescription(selectedProvider),
            status: providerDetailStatus(
              selectedProvider,
              selectedProviderState,
              selectedConfiguredGroup,
            ),
          }}
        >
          {providerSection === "connection" ? (
            <ProviderConnectionSection
              apiKeys={providerApiKeys}
              busy={busy || busyKeyId !== null}
              group={selectedConfiguredGroup}
              onCopyKey={copyApiKey}
              onDeleteKey={setDeleteKey}
              onEditKey={(key) => {
                setEditingKey(key);
                setEditorProviderId(key.providerId);
              }}
              onError={onError}
              onMoveKey={moveApiKey}
              onNotice={onNotice}
              onOpenNewKey={() => {
                setEditingKey(null);
                setEditorProviderId(providerID);
              }}
              onRefresh={async () => {
                await providerManagementStore.refreshConnections();
              }}
              onSetActiveKey={(key) =>
                mutateKey(
                  key.id,
                  () =>
                    providerManagementStore.setActiveCredential(
                      key.providerId,
                      key.id,
                    ),
                  "当前活动 API Key 已切换。",
                ).then(() => undefined)
              }
              onTestConnection={testConnection}
              onTestKey={testSingleApiKey}
              onToggleKeyEnabled={(key) =>
                mutateKey(
                  key.id,
                  () =>
                    providerManagementStore.setCredentialEnabled(
                      key.id,
                      !key.enabled,
                    ),
                  key.enabled ? "API Key 已停用。" : "API Key 已启用。",
                ).then(() => undefined)
              }
              provider={selectedProvider}
              providerState={selectedProviderState}
            />
          ) : (
            <ProviderModelsSection
              busy={busy}
              modelMetadata={modelMetadata}
              models={providerModels}
              onError={onError}
              onFetchModels={fetchModels}
              onNotice={onNotice}
              provider={selectedProvider}
            />
          )}
        </ProviderDetail>
      ) : (
        <ProviderCatalog
          catalogSourceLabel={catalogSourceLabel}
          filter={catalogFilter}
          onAddConnection={(nextProviderID) =>
            setConnectionDialogProviderId(nextProviderID)
          }
          onFilterChange={setCatalogFilter}
          onManageConnection={(nextProviderID) => {
            selectProvider(nextProviderID);
          }}
          onQueryChange={setProviderSearch}
          onSelect={selectProvider}
          providers={providerCatalogItems}
          query={providerSearch}
        />
      )}

      {/* Dialogs */}
      <ProviderConnectionDialog
        busy={busy}
        open={connectionDialogProviderId !== null}
        provider={connectionDialogProvider}
        sources={connectionDialogSources}
        onKeySubmit={createProviderConnection}
        onConnected={() => {
          setConnectionDialogProviderId(null);
          if (connectionDialogProvider) {
            updateLocation({
              provider: connectionDialogProvider.providerID,
              section: "connection",
            });
          }
        }}
        onOpenChange={(open) => {
          if (!open) setConnectionDialogProviderId(null);
        }}
      />

      <ProviderEditorDialog
        open={providerEditorOpen}
        provider={
          providerEditorProviderId
            ? providers.find(
                (item) => item.providerID === providerEditorProviderId,
              )
            : undefined
        }
        onOpenChange={setProviderEditorOpen}
        onSaved={async (savedProviderId) => {
          await providerManagementStore.refresh();
          const nextId = savedProviderId as ModelProviderID;
          setProviderEditorProviderId(null);
          applyProviderSelection(
            nextId,
            providerManagementStore
              .getSnapshot()
              .providers.find((item) => item.providerID === nextId),
          );
          updateLocation({ provider: nextId, section: "connection" });
          onNotice("自定义 Provider 配置已保存。");
        }}
      />

      <ApiKeyEditorDialog
        apiKey={editingKey}
        busy={busyKeyId !== null}
        initialProviderId={editorProviderId ?? providerID}
        open={editorProviderId !== null}
        providers={editorProvider ? [editorProvider] : []}
        onOpenChange={(open) => {
          if (open) return;
          setEditorProviderId(null);
          setEditingKey(null);
        }}
        onSubmit={saveApiKeyEditor}
      />

      <ConfirmationDialog
        actionDisabled={busyKeyId !== null}
        actionLabel="删除"
        description={deleteConfirmation?.description ?? ""}
        open={deleteKey !== null}
        title={deleteConfirmation?.title ?? "删除 API Key？"}
        tone="danger"
        onAction={() => {
          if (!deleteKey) return;
          const target = deleteKey;
          void mutateKey(
            target.id,
            () => providerManagementStore.deleteCredential(target.id),
            "API Key 已删除。",
          ).then((success) => {
            if (success) setDeleteKey(null);
          });
        }}
        onCancel={() => setDeleteKey(null)}
      />
    </div>
  );
}

type ModelCenterInitialSkeletonProps = {
  view: "catalog" | "detail";
  section: "connection" | "models";
};

function ModelCenterInitialSkeleton({
  view,
  section,
}: ModelCenterInitialSkeletonProps): React.ReactNode {
  if (view === "detail") {
    return (
      <SkeletonRegion
        className="model-center-initial-skeleton"
        label="正在加载 Provider 详情"
      >
        <header className="model-center-skeleton-provider-header">
          <SkeletonBlock className="model-center-skeleton-back" />
          <SkeletonBlock className="model-center-skeleton-provider-logo" />
          <div>
            <SkeletonBlock className="model-center-skeleton-provider-title" />
            <SkeletonBlock className="model-center-skeleton-provider-copy" />
          </div>
        </header>
        <div className="model-center-skeleton-tabs">
          <SkeletonBlock className="model-center-skeleton-tab" />
          <SkeletonBlock className="model-center-skeleton-tab" />
        </div>
        {section === "models" ? (
          <>
            <SkeletonBlock className="model-center-skeleton-search" />
            <div className="model-center-skeleton-model-grid">
              {Array.from({ length: 6 }, (_, index) => (
                <SkeletonBlock
                  className="model-center-skeleton-model-card"
                  key={index}
                />
              ))}
            </div>
          </>
        ) : (
          <div className="model-center-skeleton-detail-sections">
            <SkeletonBlock />
            <SkeletonBlock />
          </div>
        )}
      </SkeletonRegion>
    );
  }

  return (
    <SkeletonRegion
      className="model-center-initial-skeleton"
      label="正在加载 Provider 目录"
    >
      <div className="model-center-heading model-center-skeleton-heading">
        <SkeletonBlock className="model-center-skeleton-page-title" />
        <SkeletonBlock className="model-center-skeleton-page-copy" />
      </div>
      <div className="model-center-catalog-toolbar">
        <SkeletonBlock className="model-center-skeleton-search" />
        <SkeletonBlock className="model-center-skeleton-count" />
      </div>
      <div className="model-center-skeleton-provider-grid">
        {Array.from({ length: 6 }, (_, index) => (
          <div className="model-center-skeleton-provider-card" key={index}>
            <SkeletonBlock className="model-center-skeleton-logo" />
            <div>
              <SkeletonBlock className="model-center-skeleton-name" />
              <SkeletonBlock className="model-center-skeleton-meta" />
            </div>
            <SkeletonBlock className="model-center-skeleton-status" />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

function providerDescription(
  provider: DesktopModelProviderSummary | undefined,
): string {
  if (!provider) return "管理供应商凭据与模型目录。";
  const parts = [provider.providerID];
  parts.push(
    provider.providerKind === "custom"
      ? "自定义 Provider · Pi 执行"
      : provider.providerKind === "models-dev"
        ? "models.dev · OpenAI 兼容"
        : provider.catalogOrigin === "models-dev"
          ? "Pi 原生执行 · models.dev 目录"
          : "Pi 内置",
  );
  return parts.join(" · ");
}

function providerDetailStatus(
  provider: DesktopModelProviderSummary,
  providerState: DesktopModelProviderState | null,
  group: ConfiguredProviderGroup | undefined,
): { label: string; tone: "positive" | "warning" | "neutral" } {
  if (provider.availability?.status === "unavailable") {
    return {
      label: providerAvailabilityLabel(provider.availability.reason),
      tone: "warning",
    };
  }
  if (group?.activeConnection) {
    return { label: "已连接", tone: "positive" };
  }
  if (providerState?.apiKeyConfigured) {
    return { label: "已配置", tone: "positive" };
  }
  return { label: "未配置", tone: "neutral" };
}

function providerAvailabilityLabel(
  reason: "unsupported-protocol"
    | "missing-api"
    | "unsafe-endpoint"
    | "unresolved-endpoint"
    | "no-compatible-models",
): string {
  switch (reason) {
    case "missing-api": return "缺少 API 地址";
    case "unsafe-endpoint": return "Endpoint 不安全";
    case "unresolved-endpoint": return "Endpoint 尚未配置";
    case "no-compatible-models": return "没有兼容模型";
    case "unsupported-protocol": return "协议暂未适配";
  }
}

function catalogSourceStatusLabel(
  status: DesktopModelProviderSummary["catalogSource"],
): string {
  if (!status || status.mode === "pi-bundled") {
    return "models.dev 不可用 · 使用 Pi 内置目录";
  }
  if (status.mode === "cache") return "models.dev · 使用缓存";
  return "models.dev · 已更新";
}

function providerCatalogConnectionStatus(
  status:
    | "stored-key"
    | "oauth"
    | "environment"
    | "configured"
    | "unconfigured",
  group: ConfiguredProviderGroup | undefined,
): { label: string; tone: "positive" | "warning" | "neutral" } {
  if (group?.activeConnection) {
    if (group.activeConnection.kind === "oauth") {
      return { label: "OAuth 已连接", tone: "positive" };
    }
    return { label: "已保存 Key", tone: "positive" };
  }
  if (status === "stored-key") return { label: "已保存 Key", tone: "positive" };
  if (status === "oauth") return { label: "OAuth 已连接", tone: "positive" };
  if (status === "environment") return { label: "环境变量", tone: "positive" };
  if (status === "configured") return { label: "已配置", tone: "positive" };
  return { label: "未配置", tone: "neutral" };
}
