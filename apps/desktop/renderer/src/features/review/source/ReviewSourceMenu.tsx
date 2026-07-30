import type React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { DesktopReviewSource } from "../../../../shared/types.js";
import {
  PopoverItem,
  PopoverRadioGroup,
  PopoverRadioItem,
} from "../../../components/ui/PopoverItem.js";
import { PopoverMenu } from "../../../components/ui/PopoverMenu.js";
import { buildPopoverSizingStyle } from "../../../components/ui/popoverSizing.js";
import { APP_ICON_SIZE } from "../../../components/ui/iconTokens.js";
import {
  pickDefaultReviewBaseBranch,
  reviewSourceLabel,
  type ReviewBranch,
  type ReviewCommit,
} from "./reviewAgentClient.js";

type ReviewSourceMenuProps = {
  branches: readonly ReviewBranch[];
  commits: readonly ReviewCommit[];
  open: boolean;
  source: DesktopReviewSource;
  sourceOptionsState: "idle" | "loading" | "ready" | "error";
  onOpenChange: (open: boolean) => void;
  onRetry: () => void;
  onSelectLastTurn: () => void;
  onSelectSource: (source: DesktopReviewSource) => void;
};

export function ReviewSourceMenu({
  branches,
  commits,
  open,
  source,
  sourceOptionsState,
  onOpenChange,
  onRetry,
  onSelectLastTurn,
  onSelectSource,
}: ReviewSourceMenuProps): React.ReactNode {
  const defaultBaseBranch = pickDefaultReviewBaseBranch(branches);

  return (
    <PopoverMenu
      align="start"
      avoidCollisions={false}
      className="popover-review-scope popover-menu--flex"
      open={open}
      side="bottom"
      sideOffset={4}
      width={200}
      trigger={
        <button
          aria-label="切换变更范围"
          className="review-scope-trigger"
          type="button"
        >
          <span className="review-scope-trigger-label">
            {reviewSourceLabel(source)}
          </span>
          <ChevronDown size={APP_ICON_SIZE} />
        </button>
      }
      onOpenChange={onOpenChange}
    >
      <PopoverRadioGroup
        value={source.kind === "last-turn" ? "last-turn" : ""}
        onValueChange={onSelectLastTurn}
      >
        <PopoverRadioItem value="last-turn">上一轮</PopoverRadioItem>
      </PopoverRadioGroup>
      <DropdownMenu.Separator className="review-source-menu-separator" />
      <DropdownMenu.Label className="review-source-menu-label">
        未提交
      </DropdownMenu.Label>
      <PopoverRadioGroup
        value={
          source.kind === "unstaged" || source.kind === "staged"
            ? source.kind
            : ""
        }
        onValueChange={kind =>
          onSelectSource({ kind: kind as "unstaged" | "staged" })
        }
      >
        <PopoverRadioItem value="unstaged">未暂存</PopoverRadioItem>
        <PopoverRadioItem value="staged">已暂存</PopoverRadioItem>
      </PopoverRadioGroup>
      <DropdownMenu.Separator className="review-source-menu-separator" />
      <ReviewCommitSourceSubmenu>
        {sourceOptionsState === "loading" ? (
          <div className="review-source-submenu-message">正在加载提交…</div>
        ) : sourceOptionsState === "error" ? (
          <>
            <div className="review-source-submenu-message">无法加载提交记录</div>
            <PopoverItem onClick={onRetry}>重试</PopoverItem>
          </>
        ) : commits.length === 0 ? (
          <div className="review-source-submenu-message">分支上暂无提交记录</div>
        ) : (
          <PopoverRadioGroup
            value={source.kind === "commit" ? source.commitSha : ""}
            onValueChange={commitSha =>
                  onSelectSource({
                    kind: "commit",
                    commitSha,
                  })
                }
          >
            <div className="review-source-commit-list">
              {commits.map((commit) => (
                <PopoverRadioItem
                  key={`commit:${commit.sha}`}
                  value={commit.sha}
                >
                  <span
                    className="review-source-commit-row"
                    title={commit.subject || commit.shortSha}
                  >
                    <span>{commit.subject || "无提交信息"}</span>
                    <small>{formatRelativeCommitTime(commit.authoredAt)}</small>
                  </span>
                </PopoverRadioItem>
              ))}
            </div>
          </PopoverRadioGroup>
        )}
      </ReviewCommitSourceSubmenu>
      <PopoverRadioGroup
        value={source.kind === "branch" ? "branch" : ""}
        onValueChange={() => {
          if (!defaultBaseBranch) return;
          onSelectSource({ kind: "branch", baseBranch: defaultBaseBranch });
        }}
      >
        <PopoverRadioItem
          disabled={defaultBaseBranch === null}
          value="branch"
        >
          分支
        </PopoverRadioItem>
      </PopoverRadioGroup>
    </PopoverMenu>
  );
}

function ReviewCommitSourceSubmenu({
  children,
}: {
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger
        className="popover-item popover-sub-trigger"
        tabIndex={-1}
      >
        <span className="popover-item-label">提交</span>
        <span className="popover-item-trailing">
          <ChevronRight
            className="popover-item-arrow"
            size={APP_ICON_SIZE}
          />
        </span>
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent
          alignOffset={-4}
          className="popover-surface popover popover-sub-content popover-review-commits popover-menu--flex"
          collisionPadding={6}
          sideOffset={4}
          style={buildPopoverSizingStyle({ width: 320 })}
        >
          {children}
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
}

function formatRelativeCommitTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  const elapsed = Math.max(0, Date.now() - timestamp);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (elapsed < minute) return "刚刚";
  if (elapsed < hour) return `${Math.floor(elapsed / minute)} 分钟前`;
  if (elapsed < day) return `${Math.floor(elapsed / hour)} 小时前`;
  return `${Math.floor(elapsed / day)} 天前`;
}
