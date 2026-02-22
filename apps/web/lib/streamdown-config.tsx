import type { ComponentProps, ReactNode } from "react";
import { Children, cloneElement, isValidElement } from "react";
import type { BundledTheme } from "shiki";
import { code } from "@streamdown/code";

export const streamdownPlugins = { code };

export const shikiThemes = ["github-light", "github-dark"] as [
  BundledTheme,
  BundledTheme,
];

export const customComponents = {
  pre: ({ children, ...props }: ComponentProps<"pre">) => {
    const processChildren = (child: ReactNode): ReactNode => {
      if (
        isValidElement<{ children?: ReactNode; "data-block"?: string }>(child)
      ) {
        const codeContent = child.props.children;
        if (typeof codeContent === "string") {
          return cloneElement(child, {
            "data-block": "true",
            children: codeContent.trimEnd(),
          });
        }
        return cloneElement(child, { "data-block": "true" });
      }
      return child;
    };
    return <pre {...props}>{Children.map(children, processChildren)}</pre>;
  },
};
