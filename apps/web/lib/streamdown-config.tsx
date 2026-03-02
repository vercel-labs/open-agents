import { createCodePlugin } from "@streamdown/code";
import { vercelDark, vercelLight } from "./vercel-themes";

const baseCodePlugin = createCodePlugin({
  themes: [vercelLight, vercelDark],
});

type HighlightOptions = Parameters<typeof baseCodePlugin.highlight>[0];
type HighlightResult = NonNullable<ReturnType<typeof baseCodePlugin.highlight>>;
type HighlightCallback = (result: HighlightResult) => void;
type HighlightLine = HighlightResult["tokens"][number];
type HighlightToken = HighlightLine[number];
type TokenHtmlStyle = NonNullable<HighlightToken["htmlStyle"]>;

type CssDeclarations = Record<string, string>;

function parseCssValue(value: string): {
  baseValue: string | undefined;
  declarations: CssDeclarations;
} {
  const declarations: CssDeclarations = {};
  let baseValue: string | undefined;

  for (const rawSegment of value.split(";")) {
    const segment = rawSegment.trim();
    if (!segment) {
      continue;
    }

    const separatorIndex = segment.indexOf(":");
    if (separatorIndex === -1) {
      if (!baseValue) {
        baseValue = segment;
      }
      continue;
    }

    const property = segment.slice(0, separatorIndex).trim();
    const propertyValue = segment.slice(separatorIndex + 1).trim();
    if (!property || !propertyValue) {
      continue;
    }

    declarations[property] = propertyValue;
  }

  return { baseValue, declarations };
}

function mergeDeclarations(
  target: CssDeclarations,
  source: CssDeclarations,
): void {
  for (const [property, propertyValue] of Object.entries(source)) {
    target[property] = propertyValue;
  }
}

function consumeThemeValue(
  value: string | undefined,
  declarationTarget: CssDeclarations,
): string | undefined {
  if (!value) {
    return value;
  }

  const { baseValue, declarations } = parseCssValue(value);
  mergeDeclarations(declarationTarget, declarations);

  return baseValue;
}

function normalizeTokenStyleProperty(
  htmlStyle: TokenHtmlStyle,
  property: "color" | "background-color",
): string | undefined {
  const value = htmlStyle[property];
  if (typeof value !== "string") {
    return undefined;
  }

  const { baseValue, declarations } = parseCssValue(value);
  mergeDeclarations(htmlStyle, declarations);
  delete htmlStyle[property];

  return baseValue;
}

function normalizeHighlightToken(token: HighlightToken): HighlightToken {
  const htmlStyle = token.htmlStyle ? { ...token.htmlStyle } : undefined;
  if (!htmlStyle) {
    return token;
  }

  const color = normalizeTokenStyleProperty(htmlStyle, "color") ?? token.color;
  const bgColor =
    normalizeTokenStyleProperty(htmlStyle, "background-color") ?? token.bgColor;

  return {
    ...token,
    bgColor,
    color,
    htmlStyle,
  };
}

function mergeRootStyle(
  rootStyle: string | undefined,
  declarations: CssDeclarations,
): string | undefined {
  const declarationEntries = Object.entries(declarations);
  if (declarationEntries.length === 0) {
    return rootStyle;
  }

  const rootStyleParts: string[] = [];
  if (typeof rootStyle === "string" && rootStyle.length > 0) {
    rootStyleParts.push(rootStyle);
  }

  for (const [property, propertyValue] of declarationEntries) {
    rootStyleParts.push(`${property}:${propertyValue}`);
  }

  return rootStyleParts.join(";");
}

export function normalizeStreamdownHighlightResult(
  result: HighlightResult,
): HighlightResult {
  // Shiki dual-theme output can encode dark-mode overrides in semicolon-delimited
  // values. Streamdown expects base colors in fg/bg + token color/bgColor, with
  // dark variants left in CSS variables on styles.
  const rootDeclarations: CssDeclarations = {};
  const fg = consumeThemeValue(result.fg, rootDeclarations);
  const bg = consumeThemeValue(result.bg, rootDeclarations);
  const tokens: HighlightResult["tokens"] = result.tokens.map(
    (line: HighlightLine) => line.map(normalizeHighlightToken),
  );
  const rootStyle = mergeRootStyle(result.rootStyle, rootDeclarations);

  return {
    ...result,
    bg,
    fg,
    rootStyle,
    tokens,
  };
}

const codePlugin = {
  ...baseCodePlugin,
  highlight(options: HighlightOptions, callback?: HighlightCallback) {
    const normalizedCallback: HighlightCallback | undefined = callback
      ? (result) => {
          callback(normalizeStreamdownHighlightResult(result));
        }
      : undefined;

    const result = baseCodePlugin.highlight(options, normalizedCallback);
    return result ? normalizeStreamdownHighlightResult(result) : null;
  },
};

export const streamdownPlugins = {
  code: codePlugin,
};
