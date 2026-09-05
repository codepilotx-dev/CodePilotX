import { Link2, Server, KeyRound, CheckCircle2, AlertTriangle, ShieldCheck } from "lucide-react";
import type React from "react";
import type { ModelProviderID } from "../../../shared/types.js";
import { Button } from "../../components/ui/Button.js";
import { SearchInput } from "../../components/ui/SearchInput.js";
import { RemoteImage } from "../../components/ui/RemoteImage.js";
import { SegmentedControl } from "../../components/ui/SegmentedControl.js";
import {
  APP_ICON_SIZE,
  APP_ICON_STROKE_WIDTH,
} from "../../components/ui/iconTokens.js";
import type { ProviderCatalogFilter } from "./modelCenterState.js";

export type ProviderCatalogStatusTone =
  | "positive"
  | "warning"
  | "danger"
  | "neutral";

export type ProviderCatalogItem = {
  id: ModelProviderID;
  name: string;
  logoURL?: string;
  source: string;
  modelCount: number;
  current: boolean;
  canAddConnection: boolean;
  connectionDisabled?: boolean;
  keyCount?: number;
  hasOAuth?: boolean;
  healthTone?: "healthy" | "warning" | "neutral";
  status: {
    label: string;
    tone: ProviderCatalogStatusTone;
  };
};

export type ProviderCatalogProps = {
  providers: readonly ProviderCatalogItem[];
  query: string;
  onQueryChange: (query: string) => void;
  filter?: ProviderCatalogFilter;
  onFilterChange?: (filter: ProviderCatalogFilter) => void;
  onSelect: (providerId: ModelProviderID) => void;
  onAddConnection: (providerId: ModelProviderID) => void;
  onManageConnection: (providerId: ModelProviderID) => void;
};

export function ProviderCatalog({
  providers,
  query,
  onQueryChange,
  filter = "all",
  onFilterChange,
  onSelect,
  onAddConnection,
  onManageConnection,
}: ProviderCatalogProps): React.ReactNode {
  return (
    <section className="model-center-catalog" aria-label="供应商目录">
      <div className="model-center-catalog-toolbar settings-management-toolbar">
        <SearchInput
          aria-label="搜索 Provider"
          className="model-center-catalog-search"
          onChange={onQueryChange}
          placeholder="搜索供应商名称、ID 或模型"
          value={query}
        />
        {onFilterChange ? (
          <SegmentedControl<ProviderCatalogFilter>
            ariaLabel="供应商筛选"
            className="model-center-catalog-filter"
            onChange={onFilterChange}
            options={[
              { value: "all", label: "全部" },
              { value: "configured", label: "已配置" },
              { value: "unconfigured", label: "未配置" },
            ]}
            value={filter}
          />
        ) : null}
        <span className="model-center-catalog-count">
          {providers.length} 个
        </span>
      </div>

      {providers.length === 0 ? (
        <div className="model-center-catalog-empty">
          <Server
            aria-hidden
            size={APP_ICON_SIZE + 4}
            strokeWidth={APP_ICON_STROKE_WIDTH}
          />
          <strong>没有匹配的供应商</strong>
          <span>尝试调整搜索关键词或筛选条件。</span>
        </div>
      ) : (
        <div className="model-center-catalog-list settings-management-list">
          {providers.map((provider) => {
            const hasKeys = (provider.keyCount ?? 0) > 0;
            return (
              <article
                className="provider-card settings-management-row"
                data-current={provider.current || undefined}
                data-unavailable={provider.connectionDisabled || undefined}
                key={provider.id}
              >
                <button
                  aria-current={provider.current ? "page" : undefined}
                  className="provider-card-main settings-management-row-main"
                  type="button"
                  onClick={() => onSelect(provider.id)}
                >
                  <span className="provider-card-logo settings-management-row-icon">
                    {provider.logoURL ? (
                      <RemoteImage
                        alt=""
                        fallback={
                          <Server
                            aria-hidden
                            size={APP_ICON_SIZE + 4}
                            strokeWidth={APP_ICON_STROKE_WIDTH}
                          />
                        }
                        src={provider.logoURL}
                      />
                    ) : (
                      <Server
                        aria-hidden
                        size={APP_ICON_SIZE + 4}
                        strokeWidth={APP_ICON_STROKE_WIDTH}
                      />
                    )}
                  </span>
                  <span className="provider-card-copy settings-management-row-copy">
                    <span className="provider-card-heading">
                      <strong className="settings-management-row-title" title={provider.name}>{provider.name}</strong>
                      {provider.current ? (
                        <span className="provider-card-current">当前</span>
                      ) : null}
                    </span>
                    <span className="provider-card-meta settings-management-row-description">
                      <span>{provider.modelCount} 个模型</span>
                      {hasKeys ? (
                        <span className="provider-card-badge" data-tone="info">
                          {provider.keyCount} 个 Key
                        </span>
                      ) : provider.hasOAuth ? (
                        <span className="provider-card-badge" data-tone="info">
                          OAuth 已连接
                        </span>
                      ) : (
                        <span
                          className="provider-card-badge"
                          data-tone={provider.status.tone}
                        >
                          {provider.status.label}
                        </span>
                      )}
                    </span>
                  </span>
                  {provider.healthTone === "healthy" ? (
                    <span
                      className="provider-card-health-indicator"
                      data-tone="healthy"
                      title="凭据健康"
                    >
                      <CheckCircle2 size={14} aria-hidden />
                    </span>
                  ) : provider.healthTone === "warning" ? (
                    <span
                      className="provider-card-health-indicator"
                      data-tone="warning"
                      title="凭据异常"
                    >
                      <AlertTriangle size={14} aria-hidden />
                    </span>
                  ) : null}
                </button>
                <span className="settings-management-row-actions">
                  <Button
                    color="secondary"
                    className="provider-card-connection-action"
                    disabled={provider.connectionDisabled}
                    onClick={() =>
                      provider.canAddConnection
                        ? onAddConnection(provider.id)
                        : onManageConnection(provider.id)
                    }
                  >
                    <Link2
                      aria-hidden
                      size={APP_ICON_SIZE}
                      strokeWidth={APP_ICON_STROKE_WIDTH}
                    />
                    {provider.connectionDisabled
                      ? "不可用"
                      : provider.canAddConnection ? "连接" : "查看"}
                  </Button>
                </span>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
