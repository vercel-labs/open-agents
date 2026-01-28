import {
  type BorderSides,
  type KeyEvent,
  type PasteEvent,
  TextAttributes,
} from "@opentui/core";
import {
  type BoxProps as OpenTuiBoxProps,
  type MarkdownProps as OpenTuiMarkdownProps,
  type ScrollBoxProps as OpenTuiScrollBoxProps,
  type TextProps as OpenTuiTextProps,
  useKeyboard,
  useRenderer,
  useTerminalDimensions,
} from "@opentui/react";
import React, { useCallback, useEffect, useMemo, useRef } from "react";

type InkKey = {
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  return?: boolean;
  escape?: boolean;
  backspace?: boolean;
  delete?: boolean;
  tab?: boolean;
  shift?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  option?: boolean;
};

type UseInputOptions = {
  isActive?: boolean;
};

type UseInputHandler = (input: string, key: InkKey) => void;

type InkTextProps = Omit<
  OpenTuiTextProps,
  "fg" | "bg" | "attributes" | "truncate" | "wrapMode"
> & {
  color?: string;
  backgroundColor?: string;
  bold?: boolean;
  dimColor?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
  wrap?: "truncate";
  attributes?: number;
};

type InkBoxProps = Omit<OpenTuiBoxProps, "border" | "borderStyle"> & {
  border?: boolean;
  borderTop?: boolean;
  borderBottom?: boolean;
  borderLeft?: boolean;
  borderRight?: boolean;
  borderStyle?: "single" | "double" | "round" | "rounded" | "heavy";
};

type InkScrollBoxProps = Omit<
  OpenTuiScrollBoxProps,
  "border" | "borderStyle"
> & {
  border?: boolean;
  borderTop?: boolean;
  borderBottom?: boolean;
  borderLeft?: boolean;
  borderRight?: boolean;
  borderStyle?: "single" | "double" | "round" | "rounded" | "heavy";
};

type InkMarkdownProps = OpenTuiMarkdownProps;

function getAttributes({
  bold,
  dimColor,
  italic,
  underline,
  inverse,
  attributes,
}: Pick<
  InkTextProps,
  "bold" | "dimColor" | "italic" | "underline" | "inverse" | "attributes"
>): number {
  let computed = typeof attributes === "number" ? attributes : 0;
  if (bold) computed |= TextAttributes.BOLD;
  if (dimColor) computed |= TextAttributes.DIM;
  if (italic) computed |= TextAttributes.ITALIC;
  if (underline) computed |= TextAttributes.UNDERLINE;
  if (inverse) computed |= TextAttributes.INVERSE;
  return computed;
}

function normalizeColor(color?: string): string | undefined {
  if (!color) return undefined;
  if (color === "yellow") return "#ff9f1a";
  if (color === "brightYellow") return "#ffc266";
  return color;
}

function getBorderValue(props: InkBoxProps): boolean | BorderSides[] {
  const sides: BorderSides[] = [];
  if (props.borderTop) sides.push("top");
  if (props.borderRight) sides.push("right");
  if (props.borderBottom) sides.push("bottom");
  if (props.borderLeft) sides.push("left");
  if (sides.length > 0) return sides;
  return props.border ?? false;
}

function normalizeBorderStyle(
  borderStyle: InkBoxProps["borderStyle"],
): OpenTuiBoxProps["borderStyle"] {
  if (borderStyle === "round") return "rounded";
  return borderStyle;
}

function isInkTextElement(
  child: React.ReactNode,
): child is React.ReactElement<InkTextProps> {
  return React.isValidElement(child) && child.type === Text;
}

function isFragmentElement(
  child: React.ReactNode,
): child is React.ReactElement<{ children?: React.ReactNode }> {
  return React.isValidElement(child) && child.type === React.Fragment;
}

function renderInlineText(child: React.ReactNode): React.ReactNode {
  if (isFragmentElement(child)) {
    return <>{React.Children.map(child.props.children, renderInlineText)}</>;
  }

  if (!isInkTextElement(child)) return child;

  const inlineAttributes = getAttributes(child.props);
  const inlineColor = normalizeColor(child.props.color);
  const inlineBackground = normalizeColor(child.props.backgroundColor);

  return (
    <span fg={inlineColor} bg={inlineBackground} attributes={inlineAttributes}>
      {child.props.children}
    </span>
  );
}

export function Text({
  color,
  backgroundColor,
  bold,
  dimColor,
  italic,
  underline,
  inverse,
  wrap,
  attributes,
  children,
  ...rest
}: InkTextProps) {
  const computedAttributes = getAttributes({
    bold,
    dimColor,
    italic,
    underline,
    inverse,
    attributes,
  });
  const normalizedColor = normalizeColor(color);
  const normalizedBackground = normalizeColor(backgroundColor);

  const wrapMode = wrap === "truncate" ? "none" : undefined;
  const truncate = wrap === "truncate" ? true : undefined;

  const renderedChildren = useMemo(
    () => React.Children.map(children, renderInlineText),
    [children],
  );

  return (
    <text
      fg={normalizedColor}
      bg={normalizedBackground}
      attributes={computedAttributes}
      wrapMode={wrapMode}
      truncate={truncate}
      {...rest}
    >
      {renderedChildren}
    </text>
  );
}

export function Box({
  border,
  borderTop,
  borderBottom,
  borderLeft,
  borderRight,
  borderStyle,
  children,
  flexDirection,
  ...rest
}: InkBoxProps) {
  const normalizedStyle = normalizeBorderStyle(borderStyle);
  const borderValue = getBorderValue({
    border,
    borderTop,
    borderBottom,
    borderLeft,
    borderRight,
  });
  const direction = flexDirection ?? "row";

  return (
    <box
      border={borderValue}
      borderStyle={normalizedStyle}
      flexDirection={direction}
      {...rest}
    >
      {children}
    </box>
  );
}

export function ScrollBox({
  border,
  borderTop,
  borderBottom,
  borderLeft,
  borderRight,
  borderStyle,
  children,
  flexDirection,
  ...rest
}: InkScrollBoxProps) {
  const normalizedStyle = normalizeBorderStyle(borderStyle);
  const borderValue = getBorderValue({
    border,
    borderTop,
    borderBottom,
    borderLeft,
    borderRight,
  });
  const direction = flexDirection ?? "row";

  return (
    <scrollbox
      border={borderValue}
      borderStyle={normalizedStyle}
      flexDirection={direction}
      {...rest}
    >
      {children}
    </scrollbox>
  );
}

export function Markdown({ ...props }: InkMarkdownProps) {
  return <markdown {...props} />;
}

export function useApp() {
  const renderer = useRenderer();
  const exit = useCallback(() => {
    renderer.destroy();
  }, [renderer]);
  return { exit };
}

function inputFromKey(name: string): string {
  if (name === "space") return " ";
  if (name.length === 1) return name;
  return "";
}

function toInkKey(event: {
  name: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  option: boolean;
}): InkKey {
  return {
    upArrow: event.name === "up",
    downArrow: event.name === "down",
    leftArrow: event.name === "left",
    rightArrow: event.name === "right",
    return: event.name === "return" || event.name === "linefeed",
    escape: event.name === "escape",
    backspace: event.name === "backspace",
    delete: event.name === "delete",
    tab: event.name === "tab",
    shift: event.shift,
    ctrl: event.ctrl,
    meta: event.meta,
    option: event.option,
  };
}

export function useInput(
  handler: UseInputHandler,
  options: UseInputOptions = {},
) {
  const renderer = useRenderer();
  const handlerRef = useRef(handler);
  const activeRef = useRef(options.isActive ?? true);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    activeRef.current = options.isActive ?? true;
  }, [options.isActive]);

  useKeyboard((event: KeyEvent) => {
    if (!activeRef.current) return;
    const input = inputFromKey(event.name);
    handlerRef.current(input, toInkKey(event));
  });

  useEffect(() => {
    const onPaste = (event: PasteEvent) => {
      if (!activeRef.current) return;
      handlerRef.current(event.text, {});
    };

    renderer.keyInput.on("paste", onPaste);
    return () => {
      renderer.keyInput.off("paste", onPaste);
    };
  }, [renderer]);
}

export function useStdout() {
  const { width, height } = useTerminalDimensions();
  return { stdout: { columns: width, rows: height } };
}
