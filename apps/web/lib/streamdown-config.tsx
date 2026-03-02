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

function normalizeThemeValue(
  value: string | undefined,
  rootDeclarations: CssDeclarations,
): string | undefined {
  if (!value) {
    return value;
  }

  const { baseValue, declarations } = parseCssValue(value);
  for (const [property, propertyValue] of Object.entries(declarations)) {
    rootDeclarations[property] = propertyValue;
  }

  return baseValue;
}

function normalizeHighlightResult(result: HighlightResult): HighlightResult {
  const rootDeclarations: CssDeclarations = {};
  const fg = normalizeThemeValue(result.fg, rootDeclarations);
  const bg = normalizeThemeValue(result.bg, rootDeclarations);

  const tokens: HighlightResult["tokens"] = result.tokens.map(
    (line: HighlightLine) =>
      line.map((token: HighlightToken) => {
        const htmlStyle = token.htmlStyle ? { ...token.htmlStyle } : undefined;
        let color = token.color;
        let bgColor = token.bgColor;

        if (htmlStyle) {
          const rawColor = htmlStyle.color;
          if (typeof rawColor === "string") {
            const { baseValue, declarations } = parseCssValue(rawColor);
            if (baseValue) {
              color = baseValue;
            }
            for (const [property, propertyValue] of Object.entries(
              declarations,
            )) {
              htmlStyle[property] = propertyValue;
            }
            delete htmlStyle.color;
          }

          const rawBackgroundColor = htmlStyle["background-color"];
          if (typeof rawBackgroundColor === "string") {
            const { baseValue, declarations } =
              parseCssValue(rawBackgroundColor);
            if (baseValue) {
              bgColor = baseValue;
            }
            for (const [property, propertyValue] of Object.entries(
              declarations,
            )) {
              htmlStyle[property] = propertyValue;
            }
            delete htmlStyle["background-color"];
          }
        }

        return {
          ...token,
          bgColor,
          color,
          htmlStyle,
        };
      }),
  );

  const rootStyleParts: string[] = [];
  if (typeof result.rootStyle === "string" && result.rootStyle.length > 0) {
    rootStyleParts.push(result.rootStyle);
  }

  for (const [property, propertyValue] of Object.entries(rootDeclarations)) {
    rootStyleParts.push(`${property}:${propertyValue}`);
  }

  const rootStyle =
    rootStyleParts.length > 0 ? rootStyleParts.join(";") : result.rootStyle;

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
          callback(normalizeHighlightResult(result));
        }
      : undefined;

    const result = baseCodePlugin.highlight(options, normalizedCallback);
    return result ? normalizeHighlightResult(result) : null;
  },
};

export const streamdownPlugins = {
  code: codePlugin,
};
