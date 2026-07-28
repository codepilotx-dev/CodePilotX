import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ScrollArea } from "../../components/ui/ScrollArea.js";
import { ArrowLeft } from "lucide-react";
import { SearchInput } from "../../components/ui/SearchInput.js";
import { APP_ICON_SIZE } from "../../components/ui/iconTokens.js";
import { SidebarRow } from "../layout/sidebar/SidebarRow.js";
import {
  SETTINGS_GROUPS,
  SETTINGS_SEARCH_DOCUMENTS,
  type SettingsSearchDocument,
} from "./settingsRegistry.js";

type Props = {
  activeTab: string;
  onBack: () => void;
  onTabChange: (tabId: string) => void;
};

export function SettingsNav({ activeTab, onBack, onTabChange }: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeResultIndex, setActiveResultIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const normalizedQuery = normalizeSearchText(searchQuery);
  const searchResults = useMemo(
    () => searchSettings(normalizedQuery),
    [normalizedQuery],
  );

  useEffect(() => {
    setActiveResultIndex(0);
  }, [normalizedQuery]);

  useEffect(() => {
    if (!normalizedQuery) return;
    document
      .getElementById(`settings-search-result-${activeResultIndex}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeResultIndex, normalizedQuery]);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent): void => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLocaleLowerCase() === "f"
      ) {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  const clearSearch = useCallback((): void => {
    setSearchQuery("");
    setActiveResultIndex(0);
    searchInputRef.current?.focus();
  }, []);

  const activateResult = useCallback(
    (result: SettingsSearchDocument): void => {
      onTabChange(result.tabId);
      scrollToSettingsTarget(result);
    },
    [onTabChange],
  );

  const handleSearchKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ): void => {
    if (event.key === "Escape") {
      if (searchQuery) {
        event.preventDefault();
        clearSearch();
      } else {
        searchInputRef.current?.blur();
      }
      return;
    }
    if (!normalizedQuery || searchResults.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveResultIndex(
        (index) =>
          (index + direction + searchResults.length) % searchResults.length,
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const result = searchResults[activeResultIndex];
      if (result) activateResult(result);
    }
  };

  return (
    <ScrollArea
      aria-label="设置分类"
      className="settings-nav-scroll-area tw:min-h-0 tw:flex-1 tw:overflow-x-hidden"
      contentClassName="settings-nav-scroll-content tw:flex tw:min-w-0 tw:flex-col tw:gap-4 tw:px-1.5"
    >
      <div className="settings-nav-header tw:grid tw:shrink-0 tw:gap-3">
        <SidebarRow
          asChild
          className="settings-back-btn"
          layout="flex"
          leading={<ArrowLeft size={APP_ICON_SIZE} />}
        >
          <button onClick={onBack} type="button">
            <span>返回应用</span>
          </button>
        </SidebarRow>
        <SearchInput
          ref={searchInputRef}
          aria-label="搜索设置"
          className="settings-nav-search"
          mode="combobox"
          controls="settings-search-results"
          expanded={Boolean(normalizedQuery)}
          activeDescendant={
            normalizedQuery && searchResults[activeResultIndex]
              ? `settings-search-result-${activeResultIndex}`
              : undefined
          }
          onChange={setSearchQuery}
          onEscapeEmpty={() => searchInputRef.current?.blur()}
          placeholder="搜索设置..."
          value={searchQuery}
          variant="standard"
        />
      </div>
      <div className="settings-nav-menu tw:flex tw:w-full tw:min-w-0 tw:flex-col tw:gap-4">
        {normalizedQuery ? (
          <SearchResults
            activeIndex={activeResultIndex}
            onActivate={activateResult}
            onActiveIndexChange={setActiveResultIndex}
            results={searchResults}
          />
        ) : (
          SETTINGS_GROUPS.map((group) => (
            <section
              className="settings-nav-group tw:grid tw:gap-1"
              key={group.title}
            >
              <div className="settings-nav-group-title-row tw:grid tw:items-center tw:gap-x-2 tw:px-2 tw:py-1">
                <h2 className="settings-nav-group-title tw:m-0 tw:font-[var(--font-weight-label)] tw:text-app-text-soft">
                  {group.title}
                </h2>
                <span aria-hidden="true" className="sidebar-row-main" />
                <span aria-hidden="true" className="sidebar-row-trailing" />
              </div>
              <div className="settings-nav-group-items tw:grid tw:gap-0.5">
                {group.items.map((item) => (
                  <SidebarRow
                    active={activeTab === item.routeId}
                    asChild
                    key={item.id}
                    className="settings-nav-item"
                    layout="flex"
                    leading={<item.icon className="settings-nav-icon" />}
                  >
                    <button
                      onClick={() => onTabChange(item.routeId)}
                      type="button"
                    >
                      <span>{item.label}</span>
                    </button>
                  </SidebarRow>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </ScrollArea>
  );
}

type SearchResultsProps = {
  activeIndex: number;
  onActivate: (result: SettingsSearchDocument) => void;
  onActiveIndexChange: (index: number) => void;
  results: readonly SettingsSearchDocument[];
};

function SearchResults({
  activeIndex,
  onActivate,
  onActiveIndexChange,
  results,
}: SearchResultsProps): React.ReactNode {
  if (results.length === 0) {
    return (
      <div id="settings-search-results" role="listbox">
        <p className="tw:m-0 tw:px-3 tw:py-4 tw:text-sm tw:text-app-text-soft">
          未找到匹配的设置
        </p>
      </div>
    );
  }
  return (
    <div
      aria-label="设置搜索结果"
      className="tw:grid tw:gap-1"
      id="settings-search-results"
      role="listbox"
    >
      {results.map((result, index) => {
        const selected = index === activeIndex;
        return (
          <button
            aria-selected={selected}
            className={[
              "tw:grid tw:w-full tw:min-w-0 tw:gap-0.5 tw:rounded-lg tw:px-3 tw:py-2 tw:text-left tw:outline-none",
              selected
                ? "tw:bg-app-selected tw:text-app-text"
                : "tw:text-app-text tw:hover:bg-app-hover",
            ].join(" ")}
            id={`settings-search-result-${index}`}
            key={result.key}
            onClick={() => onActivate(result)}
            onMouseEnter={() => onActiveIndexChange(index)}
            role="option"
            tabIndex={-1}
            type="button"
          >
            <span className="tw:flex tw:min-w-0 tw:items-baseline tw:gap-1.5">
              <span className="tw:truncate tw:text-sm tw:font-[var(--font-weight-label)]">
                {result.rowTitle ?? result.pageLabel}
              </span>
              {result.rowTitle ? (
                <span className="tw:shrink-0 tw:text-xs tw:text-app-text-soft">
                  {result.pageLabel}
                </span>
              ) : null}
            </span>
            <span className="tw:line-clamp-2 tw:text-xs tw:leading-4 tw:text-app-text-soft">
              {result.description}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function searchSettings(query: string): readonly SettingsSearchDocument[] {
  if (!query) return [];
  const terms = query.split(" ");
  return SETTINGS_SEARCH_DOCUMENTS.map((document) => ({
    document,
    score: scoreSearchDocument(document, terms),
  }))
    .filter((result) => result.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.document.pageLabel.localeCompare(
          right.document.pageLabel,
          "zh-CN",
        ),
    )
    .slice(0, 40)
    .map((result) => result.document);
}

function scoreSearchDocument(
  document: SettingsSearchDocument,
  terms: readonly string[],
): number {
  const page = normalizeSearchText(document.pageLabel);
  const rowTitle = normalizeSearchText(document.rowTitle ?? "");
  const description = normalizeSearchText(document.description);
  const group = normalizeSearchText(document.groupTitle);
  let total = 0;
  for (const term of terms) {
    const pageScore = scoreSearchField(page, term, 160, 130, 95);
    const rowScore = scoreSearchField(rowTitle, term, 130, 100, 75);
    const descriptionScore = description.includes(term) ? 35 : 0;
    const groupScore = group.includes(term) ? 20 : 0;
    const termScore = Math.max(
      pageScore,
      rowScore,
      descriptionScore,
      groupScore,
    );
    if (termScore === 0) return 0;
    total += termScore;
  }
  return total + (document.rowTitle ? 5 : 0);
}

function scoreSearchField(
  field: string,
  term: string,
  exact: number,
  prefix: number,
  contains: number,
): number {
  if (!field) return 0;
  if (field === term) return exact;
  if (field.startsWith(term)) return prefix;
  return field.includes(term) ? contains : 0;
}

function scrollToSettingsTarget(result: SettingsSearchDocument): void {
  let attempts = 0;
  const locate = (): void => {
    attempts += 1;
    const registeredTarget = document.getElementById(result.targetId);
    const candidates = document.querySelectorAll<HTMLElement>(
      ".settings-row-title, .settings-section-title, .settings-page-title",
    );
    const heading = [...candidates].find(
      (candidate) =>
        candidate.textContent?.trim() === (result.rowTitle ?? result.pageLabel),
    );
    const target =
      registeredTarget ??
      heading?.closest<HTMLElement>(".settings-row, .settings-section") ??
      heading;
    if (!target) {
      if (attempts < 12) {
        window.setTimeout(locate, 25);
      } else if (!result.rowTitle) {
        document
          .querySelector<HTMLElement>(".settings-content-area")
          ?.scrollTo({ behavior: "smooth", top: 0 });
      }
      return;
    }
    target.id = result.targetId;
    target.tabIndex = -1;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.focus({ preventScroll: true });
  };
  window.setTimeout(locate, 0);
}
