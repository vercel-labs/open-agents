import type { ComponentProps, ReactNode } from "react";
import { Children, cloneElement, isValidElement } from "react";
import type { BundledTheme } from "shiki";
import { createCodePlugin } from "@streamdown/code";
import { vercelLight, vercelDark } from "./vercel-themes";

export const streamdownPlugins = {
  code: createCodePlugin({
    themes: [vercelLight, vercelDark],
  }),
};

export const shikiThemes = ["vercel-light", "vercel-dark"] as [
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
