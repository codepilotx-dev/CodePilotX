import { Children, cloneElement, forwardRef } from "react";
import type { HTMLAttributes, ReactElement, ReactNode, Ref } from "react";
import { cx } from "../../../utils/cx.js";

type SidebarRowLeadingMode = "icon" | "spacer";
type SidebarRowIndent = "none" | "session";

type Props = HTMLAttributes<HTMLElement> & {
  active?: boolean;
  as?: "div" | "li";
  asChild?: boolean;
  className?: string;
  indent?: SidebarRowIndent;
  labelClassName?: string;
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
    leading,
    leadingMode = leading ? "icon" : "spacer",
    trailing,
    ...rowProps
  },
  ref,
): ReactNode {
  const rowClassName = cx(
    "sidebar-row",
    "tw:min-h-[31px] tw:w-full tw:items-center tw:gap-x-2 tw:rounded-[10px] tw:px-2 tw:py-[5px] tw:text-left tw:text-base tw:leading-[21px] tw:text-app-text tw:no-underline tw:transition-colors tw:duration-[var(--motion-fast)] tw:hover:bg-[var(--color-sidebar-hover-bg)] tw:focus-visible:outline-none tw:focus-visible:ring-1 tw:focus-visible:ring-app-accent",
    active ? "tw:bg-[var(--color-sidebar-active-bg)] tw:text-app-text" : undefined,
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
  leading,
  leadingMode,
  trailing,
}: {
  children: ReactNode;
  labelClassName?: string;
  leading?: ReactNode;
  leadingMode: SidebarRowLeadingMode;
  trailing?: ReactNode;
}): ReactNode {
  return (
    <>
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
      <span
        className={cx(
          "sidebar-row-main",
          "tw:flex tw:w-full tw:min-w-0 tw:items-center",
          labelClassName,
        )}
      >
        {children}
      </span>
      <span
        aria-hidden={trailing ? undefined : true}
        className={cx(
          "sidebar-row-trailing",
          "tw:flex tw:w-full tw:min-w-0 tw:items-center tw:justify-end",
        )}
      >
        {trailing}
      </span>
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
        "sidebar-empty-row",
        "tw:min-h-[31px] tw:w-full tw:items-center tw:gap-x-2 tw:rounded-[10px] tw:px-2 tw:py-[5px] tw:text-base tw:leading-[21px] tw:text-app-text-soft",
        className,
      )}
    >
      <p className="sidebar-empty tw:m-0 tw:min-w-0 tw:text-app-text-soft">{children}</p>
      <span
        aria-hidden="true"
        className={cx(
          "sidebar-row-main",
          "tw:flex tw:w-full tw:min-w-0 tw:items-center",
        )}
      />
      <span
        aria-hidden="true"
        className={cx(
          "sidebar-row-trailing",
          "tw:flex tw:w-full tw:min-w-0 tw:items-center tw:justify-end",
        )}
      />
    </div>
  );
}
