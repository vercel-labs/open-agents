import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function AnthropicIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" {...props}>
      <path
        fill="#D97757"
        d="m3.14 10.61 3.15-1.76.05-.15-.05-.09h-.16l-.52-.03-1.8-.05-1.56-.06-1.51-.08-.38-.09L0 7.84l.04-.24.32-.21.45.04 1.02.07 1.52.1 1.1.07 1.63.17h.26l.04-.1-.1-.07-.06-.07-1.57-1.06-1.7-1.12-.9-.65-.48-.33-.24-.3-.1-.67.43-.48.59.04.15.04.6.45 1.27.99 1.66 1.21.24.2.1-.06V5.8l-.1-.18L5.27 4 4.3 2.35l-.43-.7-.11-.4a2 2 0 0 1-.07-.49l.5-.67.27-.09.67.09.28.24.41.94.67 1.48 1.04 2.02.3.6.16.55.06.17h.1v-.1l.1-1.13.15-1.4.15-1.79.06-.5.25-.6.5-.34.39.19.32.46-.05.3-.19 1.22-.37 1.93-.24 1.3h.14l.16-.17.66-.87 1.1-1.37.48-.54.57-.6.36-.3h.7l.5.76-.23.77-.7.9-.6.76-.84 1.13L11 7l.05.08.12-.02 1.9-.4 1.03-.18 1.23-.21.56.25.06.27-.22.53-1.31.33-1.54.3-2.3.54-.02.02.03.04 1.03.1.44.03h1.08l2.02.15.52.34.32.43-.05.32-.81.41-1.1-.26-2.55-.6-.87-.22h-.12v.07l.72.71 1.34 1.2 1.67 1.56.09.38-.22.3-.22-.03-1.47-1.1-.57-.5-1.28-1.08h-.09v.12l.3.43 1.56 2.34.08.72-.11.23-.4.14-.45-.08-.92-1.28-.94-1.44-.76-1.29-.1.05-.45 4.83-.2.24-.5.19-.4-.3-.21-.5.21-.99.26-1.28.21-1.01.2-1.27.1-.42v-.02h-.1L6.9 11.5l-1.46 1.95-1.15 1.23-.27.11-.48-.25.04-.44.27-.39 1.6-2.02.95-1.25.62-.72v-.1h-.04l-4.23 2.73-.75.1-.32-.3.04-.5.15-.16z"
      />
    </svg>
  );
}

function OpenAIIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" {...props}>
      <g clipPath="url(#logo-open-ai__a)">
        <path
          fill="currentColor"
          d="M6.14 5.84v-1.5q-.01-.2.16-.29l3.02-1.74q.63-.35 1.42-.35c1.9 0 3.1 1.47 3.1 3.04l-.01.37-3.14-1.84a.5.5 0 0 0-.57 0zm7.07 5.87v-3.6q0-.32-.29-.5l-3.98-2.3 1.3-.75q.16-.09.32 0L13.6 6.3c.87.51 1.46 1.59 1.46 2.64 0 1.2-.71 2.31-1.84 2.77m-8-3.17-1.3-.76q-.17-.1-.17-.29V4c0-1.7 1.3-2.98 3.06-2.98q1.02.01 1.81.62L5.5 3.44a.5.5 0 0 0-.29.5zM8 10.16 6.14 9.1V6.89L8 5.84 9.86 6.9v2.22zm1.2 4.82q-1.02-.01-1.81-.62l3.12-1.8a.5.5 0 0 0 .29-.5v-4.6l1.31.76q.17.1.16.29V12c0 1.7-1.31 2.98-3.07 2.98m-3.76-3.54L2.4 9.7A3.1 3.1 0 0 1 .95 7.06c0-1.22.73-2.31 1.86-2.77V7.9q0 .34.28.5l3.97 2.3-1.3.74a.3.3 0 0 1-.32 0m-.18 2.6c-1.79 0-3.1-1.35-3.1-3.01q0-.19.03-.38l3.12 1.8q.3.18.57 0l3.98-2.3v1.51q.01.2-.16.29l-3.02 1.74q-.63.35-1.42.35m3.94 1.89a3.96 3.96 0 0 0 3.88-3.17 3.97 3.97 0 0 0 1.59-6.79q.12-.5.12-1a3.96 3.96 0 0 0-5.21-3.76 3.97 3.97 0 0 0-6.66 2.03 3.97 3.97 0 0 0-1.59 6.79q-.12.5-.12 1a3.96 3.96 0 0 0 5.21 3.76c.72.7 1.7 1.14 2.78 1.14"
        />
      </g>
      <defs>
        <clipPath id="logo-open-ai__a">
          <rect width="16" height="16" fill="currentColor" />
        </clipPath>
      </defs>
    </svg>
  );
}

function GoogleIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" {...props}>
      <path
        fill="#4285F4"
        d="M8.16 6.55v3.1h4.3c-.18.99-.75 1.83-1.6 2.4l2.6 2.02a7.8 7.8 0 0 0 2.38-5.89q0-.85-.15-1.63z"
      />
      <path
        fill="#34A853"
        d="m3.68 9.52-.59.45-2.07 1.62A8 8 0 0 0 8.16 16c2.16 0 3.97-.71 5.3-1.93l-2.6-2.02a4.78 4.78 0 0 1-7.18-2.52"
      />
      <path
        fill="#FBBC05"
        d="M1.02 4.41a7.9 7.9 0 0 0 0 7.18l2.66-2.07a4.8 4.8 0 0 1 0-3.04z"
      />
      <path
        fill="#EA4335"
        d="M8.16 3.19c1.18 0 2.23.4 3.06 1.19l2.3-2.3a7.99 7.99 0 0 0-12.5 2.33l2.66 2.07c.63-1.9 2.4-3.3 4.48-3.3"
      />
    </svg>
  );
}

function XAIIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" {...props}>
      <path
        fill="currentColor"
        d="M1 5.66 8.03 16h3.13L4.13 5.66zm3.13 5.74L1 16h3.13l1.56-2.3zM11.87 0l-5.4 7.95 1.56 2.3L15 0zm.57 4.92V16H15V1.15z"
      />
    </svg>
  );
}

function GroqIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.568 16.8a3.6 3.6 0 0 1-3.6 3.6H9.6a3.6 3.6 0 0 1-3.6-3.6V7.2a3.6 3.6 0 0 1 3.6-3.6h4.368a3.6 3.6 0 0 1 3.6 3.6v2.4h-2.4V7.2a1.2 1.2 0 0 0-1.2-1.2H9.6a1.2 1.2 0 0 0-1.2 1.2v9.6a1.2 1.2 0 0 0 1.2 1.2h4.368a1.2 1.2 0 0 0 1.2-1.2v-2.4h-3.6v-2.4h6z" />
    </svg>
  );
}

function MistralIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" {...props}>
      <path
        fill="#FFD800"
        d="M4.57 2.35H2.3V4.6h2.28zM13.71 2.35h-2.28V4.6h2.28z"
      />
      <path
        fill="#FFAF00"
        d="M6.86 4.6H2.29v2.27h4.57zM13.71 4.6H9.14v2.27h4.57z"
      />
      <path fill="#FF8205" d="M13.71 6.87H2.3v2.26H13.7z" />
      <path
        fill="#FA500F"
        d="M4.57 9.13H2.3v2.26h2.28zM9.14 9.13H6.86v2.26h2.28zM13.71 9.13h-2.28v2.26h2.28z"
      />
      <path fill="#E10500" d="M6.86 11.4H0v2.25h6.86zM16 11.4H9.14v2.25H16z" />
    </svg>
  );
}

function DeepSeekIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" {...props}>
      <path
        fill="#4D6BFE"
        d="M15.83 3.07c-.17-.08-.24.08-.34.16l-.1.09c-.24.27-.53.44-.9.42a1.8 1.8 0 0 0-1.45.57 1.3 1.3 0 0 0-.83-1.04c-.23-.1-.47-.2-.64-.44-.11-.16-.14-.34-.2-.51-.04-.11-.07-.22-.2-.24s-.18.1-.23.19q-.31.58-.28 1.23.02 1.45 1.22 2.28.14.08.09.21l-.18.56q-.05.18-.22.1a4 4 0 0 1-1.16-.8C9.84 5.3 9.33 4.68 8.68 4.2l-.46-.31c-.65-.64.09-1.17.26-1.23s.06-.3-.52-.29c-.58 0-1.11.2-1.79.46l-.3.1a6 6 0 0 0-1.93-.08 4.1 4.1 0 0 0-3 1.76A5.2 5.2 0 0 0 .1 8.68a6.2 6.2 0 0 0 2.24 3.8 6 6 0 0 0 4.3 1.43c.98-.06 2.08-.19 3.32-1.25.32.16.64.22 1.19.27.42.04.82-.02 1.14-.09.49-.1.45-.56.28-.64-1.44-.67-1.13-.4-1.41-.62.73-.87 1.83-1.77 2.26-4.7.03-.23 0-.38 0-.56 0-.12.02-.16.15-.18q.54-.06 1.03-.32c.93-.5 1.3-1.35 1.4-2.35 0-.16 0-.32-.17-.4m-8.11 9.07c-1.4-1.1-2.07-1.47-2.35-1.45-.26.01-.21.31-.15.51s.14.33.24.5c.08.1.13.27-.07.4-.45.28-1.23-.1-1.27-.11a6 6 0 0 1-2.2-2.22 7 7 0 0 1-.86-3c-.01-.26.06-.36.32-.4q.5-.1 1.02-.03 2.13.33 3.64 1.86c.58.58 1.02 1.27 1.47 1.94.48.72 1 1.4 1.65 1.95q.34.3.6.46c-.54.06-1.43.07-2.04-.41m.67-4.32a.2.2 0 1 1 .4 0 .2.2 0 1 1-.4 0m2.07 1.07q-.2.09-.4.1a1 1 0 0 1-.52-.16c-.19-.16-.32-.24-.37-.51-.03-.12-.01-.3 0-.4q.08-.31-.15-.49-.2-.14-.46-.13a.4.4 0 0 1-.17-.05.17.17 0 0 1-.08-.24c.02-.04.11-.13.13-.14.24-.14.51-.1.77 0 .23.1.4.28.66.53.26.3.31.39.46.62q.18.25.3.57.06.2-.17.3"
      />
    </svg>
  );
}

function PerplexityIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" {...props}>
      <path
        fill="#20808D"
        fillRule="evenodd"
        d="m2.87 0 4.56 4.2V0h.89v4.2L12.89 0v4.79h1.88v6.9H12.9v4.26l-4.58-4.02V16h-.89v-4l-4.55 4v-4.31H1v-6.9h1.87zm3.9 5.66H1.88v5.15h.99V9.2zm-3 3.92v4.47l3.66-3.23V6.25zm4.57 1.2V6.24l3.67 3.33V14zm4.56.03h.99V5.66H9.05l3.85 3.5zM12 4.8V2.02L9 4.79zm-5.23 0h-3V2.02z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function MoonshotIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" {...props}>
      <path
        fill="currentColor"
        d="M6.45 12.61q0 .9.16 1.7l4.16 1.2A7.97 7.97 0 0 1 .55 10.91zM6.97 9.15l-.04.14q-.2.71-.32 1.41l7.71 2.21q-.51.65-1.13 1.18L.38 10.42a8 8 0 0 1-.34-3.26zM8.45 5.96q-.45.66-.8 1.43l8.17 2.34a8 8 0 0 1-.44 1.38L.1 6.73a8 8 0 0 1 1.05-2.86zM11.63 3.27q-.95.32-1.84 1.12l5.99 1.72q.18.75.22 1.57L1.4 3.48A8 8 0 0 1 4 1.09zM10.2.31a8 8 0 0 1 4.56 3.4L4.56.78A8 8 0 0 1 10.2.31"
      />
    </svg>
  );
}

function CohereIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" {...props}>
      <path
        fill="#39594D"
        fillRule="evenodd"
        d="M5.18 9.54a6 6 0 0 0 2.48-.52c1.39-.57 4.12-1.6 6.1-2.66 1.39-.75 1.98-1.73 1.98-3.05A3.3 3.3 0 0 0 12.44 0H4.76A4.76 4.76 0 0 0 0 4.76c0 2.62 2 4.78 5.18 4.78"
        clipRule="evenodd"
      />
      <path
        fill="#D18EE2"
        fillRule="evenodd"
        d="M6.49 12.8c0-1.28.76-2.45 1.96-2.94l2.4-1A3.71 3.71 0 1 1 12.29 16H9.67a3.2 3.2 0 0 1-3.17-3.21"
        clipRule="evenodd"
      />
      <path
        fill="#FF7759"
        d="M2.75 10.15A2.76 2.76 0 0 0 0 12.91v.36a2.75 2.75 0 0 0 5.5-.02v-.36a2.77 2.77 0 0 0-2.75-2.74"
      />
    </svg>
  );
}

function MetaIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" {...props}>
      <path
        fill="#0081FB"
        d="M1.73 9.69c0 .6.13 1.08.3 1.36.24.37.58.53.93.53.45 0 .86-.11 1.66-1.2.63-.89 1.38-2.13 1.89-2.9l.85-1.31c.6-.92 1.28-1.93 2.07-2.62a3 3 0 0 1 2.04-.87c1.17 0 2.29.68 3.14 1.95A9 9 0 0 1 16 9.6c0 1.08-.21 1.87-.57 2.5a2.4 2.4 0 0 1-2.18 1.2v-1.72c.98 0 1.23-.9 1.23-1.93 0-1.47-.35-3.1-1.1-4.27-.54-.83-1.23-1.33-2-1.33-.82 0-1.49.62-2.23 1.73q-.59.9-1.27 2.13l-.5.89a23 23 0 0 1-1.78 2.88c-.89 1.18-1.64 1.63-2.64 1.63a2.6 2.6 0 0 1-2.4-1.29A4.7 4.7 0 0 1 0 9.62z"
      />
      <path
        fill="url(#logo-meta__a)"
        d="M1.32 4.77c.8-1.22 1.93-2.08 3.25-2.08.76 0 1.51.23 2.3.87.86.7 1.78 1.86 2.93 3.77l.4.69c1 1.65 1.57 2.5 1.9 2.9.42.52.72.67 1.1.67.99 0 1.23-.9 1.23-1.93l1.53-.05c0 1.08-.22 1.87-.58 2.5a2.4 2.4 0 0 1-2.17 1.21 2.7 2.7 0 0 1-2.05-.81c-.53-.5-1.16-1.4-1.64-2.21L8.08 7.9C7.36 6.7 6.7 5.8 6.32 5.4c-.41-.44-.94-.97-1.78-.97-.68 0-1.26.48-1.75 1.21z"
      />
      <path
        fill="url(#logo-meta__b)"
        d="M4.58 4.42c-.68 0-1.26.48-1.75 1.21a7.7 7.7 0 0 0-1.1 4.06c0 .6.13 1.08.3 1.36l-1.47.97A4.7 4.7 0 0 1 0 9.62c0-1.7.47-3.49 1.36-4.86.8-1.23 1.94-2.08 3.25-2.08z"
      />
      <defs>
        <linearGradient
          id="logo-meta__a"
          x1="3.35"
          x2="14.367"
          y1="9.203"
          y2="9.759"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#0064E1" />
          <stop offset=".4" stopColor="#0064E1" />
          <stop offset=".83" stopColor="#0073EE" />
          <stop offset="1" stopColor="#0082FB" />
        </linearGradient>
        <linearGradient
          id="logo-meta__b"
          x1="2.504"
          x2="2.504"
          y1="10.414"
          y2="6.352"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#0082FB" />
          <stop offset="1" stopColor="#0064E0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function ZAIIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" {...props}>
      <path
        fill="currentColor"
        d="M8.4 1.2 7.3 2.8a1 1 0 0 1-.78.4H.41v-2zM16 1.2 6.4 14.8H0L9.6 1.2zM7.6 14.8l1.12-1.6c.17-.25.47-.4.78-.4h6.1v2z"
      />
    </svg>
  );
}

function DefaultProviderIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
    </svg>
  );
}

export type ProviderId =
  | "anthropic"
  | "openai"
  | "google"
  | "xai"
  | "groq"
  | "mistral"
  | "deepseek"
  | "perplexity"
  | "moonshot"
  | "togetherai"
  | "cohere"
  | "fireworks"
  | "meta"
  | "zai"
  | string;

const providerIconMap: Record<string, React.FC<IconProps>> = {
  anthropic: AnthropicIcon,
  openai: OpenAIIcon,
  google: GoogleIcon,
  xai: XAIIcon,
  groq: GroqIcon,
  mistral: MistralIcon,
  deepseek: DeepSeekIcon,
  perplexity: PerplexityIcon,
  moonshot: MoonshotIcon,
  cohere: CohereIcon,
  meta: MetaIcon,
  zai: ZAIIcon,
};

const providerDisplayNames: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  xai: "xAI",
  groq: "Groq",
  mistral: "Mistral",
  deepseek: "DeepSeek",
  perplexity: "Perplexity",
  moonshot: "Moonshot",
  togetherai: "Together AI",
  cohere: "Cohere",
  fireworks: "Fireworks",
  meta: "Meta",
  zai: "ZAI",
};

/** Prefixes in model display names that match the provider brand (stripped in compact UI). */
const providerLabelPrefixes: Record<string, string[]> = {
  anthropic: ["Claude"],
  google: ["Gemini"],
  xai: ["Grok"],
  mistral: ["Mistral"],
  deepseek: ["DeepSeek"],
  meta: ["Meta"],
};

export function getProviderFromModelId(modelId: string): string {
  const slashIndex = modelId.indexOf("/");
  if (slashIndex === -1) return modelId;
  return modelId.slice(0, slashIndex);
}

/**
 * Strip the provider brand prefix from a model label for compact display.
 * e.g. "Claude Opus 4.6" → "Opus 4.6", "GPT-5.4" → "GPT-5.4"
 */
export function stripProviderPrefix(label: string, provider: string): string {
  const prefixes = providerLabelPrefixes[provider];
  if (!prefixes) return label;
  for (const prefix of prefixes) {
    if (label.startsWith(prefix + " ")) {
      return label.slice(prefix.length + 1);
    }
  }
  return label;
}

export function getProviderDisplayName(provider: string): string {
  return (
    providerDisplayNames[provider] ??
    provider.charAt(0).toUpperCase() + provider.slice(1)
  );
}

interface ProviderIconProps extends IconProps {
  provider: string;
}

export function ProviderIcon({ provider, ...props }: ProviderIconProps) {
  const Icon = providerIconMap[provider] ?? DefaultProviderIcon;
  return <Icon {...props} />;
}
