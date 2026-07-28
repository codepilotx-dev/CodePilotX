import { Children, cloneElement, forwardRef } from "react";
import type { HTMLAttributes, ReactElement, ReactNode, Ref } from "react";
import { cx } from "../../../utils/cx.js";

type SidebarRowLeadingMode = "icon" | "spacer";
type SidebarRowIndent = "none" | "session";
type SidebarRowLayout = "flex" | "grid";

type Props = HTMLAttributes<HTMLElement> & {
  active?: boolean;
  as?: "div" | "li";
  asChild?: boolean;
  className?: string;
  indent?: SidebarRowIndent;
  labelClassName?: string;
  layout: SidebarRowLayout;
  leading?: ReactNode;
  leadingMode?: SidebarRowLeadingMode;
  trailing?: ReactNode;
  children: ReactNode;
};

export const SidebarRow = forwardRef<HTMLElement, Props>(function SidebarRow(
  {
    active = false,
    as = "div",
    asChild = false,
    children,
    className,
    indent = "none",
    labelClassName,
    layout,
    leading,
    leadingMode = leading ? "icon" : "spacer",
    trailing,
    ...rowProps
  },
  ref,
): ReactNode {
  const rowClassName = cx(
    "sidebar-row",
    `sidebar-row--${layout}`,
    "tw:min-h-[31px] tw:w-full tw:items-center tw:gap-x-2 tw:rounded-[10px] tw:px-2 tw:py-[5px] tw:text-left tw:text-base tw:leading-[21px] tw:text-app-text tw:no-underline tw:transition-colors tw:duration-[var(--motion-fast)] tw:hover:bg-[var(--color-token-list-hover-background)] tw:focus-visible:outline-none tw:focus-visible:ring-1 tw:focus-visible:ring-app-accent",
    active ? "tw:bg-[var(--color-token-list-active-selection-background)] tw:text-app-text" : undefined,
    active ? "active" : undefined,
    indent === "session" ? "sidebar-row--session" : undefined,
    className,
  );

  if (asChild) {
    const child = Children.only(children) as ReactElement<{
      className?: string;
      children?: ReactNode;
      ref?: Ref<HTMLElement>;
    }>;

    return cloneElement(
      child,
      {
        ...rowProps,
        className: cx(rowClassName, child.props.className),
        ref,
      },
      renderRowContent({
        children: child.props.children,
        labelClassName,
        layout,
        leading,
        leadingMode,
        trailing,
      }),
    );
  }

  const Component = as;
  return (
    <Component className={rowClassName} ref={ref as Ref<HTMLDivElement> & Ref<HTMLLIElement>} {...rowProps}>
      {renderRowContent({
        children,
        labelClassName,
        layout,
        leading,
        leadingMode,
        trailing,
      })}
    </Component>
  );
});

function renderRowContent({
  children,
  labelClassName,
  layout,
  leading,
  leadingMode,
  trailing,
}: {
  children: ReactNode;
  labelClassName?: string;
  layout: SidebarRowLayout;
  leading?: ReactNode;
  leadingMode: SidebarRowLeadingMode;
  trailing?: ReactNode;
}): ReactNode {
  const hasLeading =
    layout === "grid" ||
    (leadingMode === "icon" && leading !== undefined && leading !== null);
  const hasTrailing = trailing !== undefined && trailing !== null;

  return (
    <>
      {hasLeading ? (
        <span
          aria-hidden={leadingMode === "spacer" ? true : undefined}
          className={cx(
            "sidebar-row-leading",
            "tw:flex tw:min-w-0 tw:items-center",
            leadingMode === "icon"
              ? "icon-button sidebar-item-icon"
              : "sidebar-row-leading-spacer",
          )}
        >
          {leadingMode === "icon" ? leading : null}
        </span>
      ) : null}
      <span
        className={cx(
          "sidebar-row-main",
          "tw:flex tw:w-full tw:min-w-0 tw:items-center",
          labelClassName,
        )}
      >
        {children}
      </span>
      {hasTrailing ? (
        <span
          className={cx(
            "sidebar-row-trailing",
            "tw:flex tw:w-full tw:min-w-0 tw:items-center tw:justify-end",
          )}
        >
          {trailing}
        </span>
      ) : null}
    </>
  );
}

export function SidebarEmptyRow({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }): ReactNode {
  return (
    <div
      {...props}
      className={cx(
        "sidebar-row",
        "sidebar-row--flex",
        "sidebar-empty-row",
        "tw:min-h-[31px] tw:w-full tw:items-center tw:gap-x-2 tw:rounded-[10px] tw:px-2 tw:py-[5px] tw:text-base tw:leading-[21px] tw:text-app-text-soft",
        className,
      )}
    >
      <p className="sidebar-empty tw:m-0 tw:min-w-0 tw:text-app-text-soft">{children}</p>
    </div>
  );
}
