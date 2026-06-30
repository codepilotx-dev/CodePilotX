import { Children, cloneElement, forwardRef } from "react";
import type { HTMLAttributes, ReactElement, ReactNode, Ref } from "react";

type SidebarRowLeadingMode = "icon" | "spacer" | "none";
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
    leadingMode = leading ? "icon" : "none",
    trailing,
    ...rowProps
  },
  ref,
): ReactNode {
  const rowClassName = joinClassNames(
    "sidebar-row",
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
        className: joinClassNames(rowClassName, child.props.className),
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
      {leadingMode !== "none" ? (
        <span
          className={joinClassNames(
            "sidebar-row-leading",
            leadingMode === "icon"
              ? "icon-button sidebar-item-icon"
              : "sidebar-row-leading-spacer",
          )}
        >
          {leadingMode === "icon" ? leading : null}
        </span>
      ) : null}
      <span className={joinClassNames("sidebar-row-main", labelClassName)}>
        {children}
      </span>
      {trailing ? <span className="sidebar-row-trailing">{trailing}</span> : null}
    </>
  );
}

function joinClassNames(
  ...classNames: Array<string | false | null | undefined>
): string {
  return classNames.filter(Boolean).join(" ");
}
