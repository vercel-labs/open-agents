/**
 * File-type icons — coloured SVG glyphs for common extensions.
 *
 * Usage:
 *   import { getFileIcon, FolderIcon, FolderOpenIcon } from "@/components/file-type-icons";
 *   <FolderIcon className="h-4 w-4" />
 *   {getFileIcon("app.tsx", { className: "h-4 w-4" })}
 */

import type { SVGProps } from "react";

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

type IconProps = SVGProps<SVGSVGElement>;

/** Base wrapper — every icon is a 16×16 SVG. */
function Svg({ children, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="none"
      width={16}
      height={16}
      {...props}
    >
      {children}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Folder icons (gray)                                                 */
/* ------------------------------------------------------------------ */

export function FolderIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        d="M1.5 2.5h4l1.5 1.5h7.5v9h-13v-10.5z"
        fill="#8b8b8b"
        fillOpacity={0.85}
        stroke="#8b8b8b"
        strokeWidth={0.5}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function FolderOpenIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        d="M1.5 2.5h4l1.5 1.5H14v2.5H3l-1.5 6V2.5z"
        fill="#8b8b8b"
        fillOpacity={0.7}
        stroke="#8b8b8b"
        strokeWidth={0.5}
        strokeLinejoin="round"
      />
      <path
        d="M3 6.5h11.5l-2 6H1.5l1.5-6z"
        fill="#8b8b8b"
        fillOpacity={0.85}
        stroke="#8b8b8b"
        strokeWidth={0.5}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/* ------------------------------------------------------------------ */
/* Language / file-type icons                                          */
/* ------------------------------------------------------------------ */

/** TypeScript — blue */
function TypeScriptIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#3178C6" />
      <text
        x="8"
        y="11.5"
        textAnchor="middle"
        fill="white"
        fontSize="8.5"
        fontWeight="bold"
        fontFamily="system-ui, sans-serif"
      >
        TS
      </text>
    </Svg>
  );
}

/** TypeScript React (TSX) — blue with a lighter tint */
function TypeScriptReactIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#2F74C0" />
      <text
        x="8"
        y="8.2"
        textAnchor="middle"
        fill="white"
        fontSize="5.5"
        fontWeight="bold"
        fontFamily="system-ui, sans-serif"
      >
        TS
      </text>
      <text
        x="8"
        y="13"
        textAnchor="middle"
        fill="#7fdbff"
        fontSize="4"
        fontWeight="bold"
        fontFamily="system-ui, sans-serif"
      >
        {"</>"}
      </text>
    </Svg>
  );
}

/** JavaScript — yellow */
function JavaScriptIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#F7DF1E" />
      <text
        x="8"
        y="11.5"
        textAnchor="middle"
        fill="#1a1a1a"
        fontSize="8.5"
        fontWeight="bold"
        fontFamily="system-ui, sans-serif"
      >
        JS
      </text>
    </Svg>
  );
}

/** JavaScript React (JSX) */
function JavaScriptReactIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#E8D44D" />
      <text
        x="8"
        y="8.2"
        textAnchor="middle"
        fill="#1a1a1a"
        fontSize="5.5"
        fontWeight="bold"
        fontFamily="system-ui, sans-serif"
      >
        JS
      </text>
      <text
        x="8"
        y="13"
        textAnchor="middle"
        fill="#6b4c00"
        fontSize="4"
        fontWeight="bold"
        fontFamily="system-ui, sans-serif"
      >
        {"</>"}
      </text>
    </Svg>
  );
}

/** JSON — yellow-green */
function JsonIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#A1A424" />
      <text
        x="8"
        y="8.5"
        textAnchor="middle"
        fill="white"
        fontSize="4.3"
        fontWeight="bold"
        fontFamily="system-ui, sans-serif"
      >
        {"{ }"}
      </text>
      <text
        x="8"
        y="12.8"
        textAnchor="middle"
        fill="rgba(255,255,255,0.7)"
        fontSize="3.2"
        fontFamily="system-ui, sans-serif"
      >
        JSON
      </text>
    </Svg>
  );
}

/** CSS — purple/blue */
function CssIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#663399" />
      <text
        x="8"
        y="11.5"
        textAnchor="middle"
        fill="white"
        fontSize="6"
        fontWeight="bold"
        fontFamily="system-ui, sans-serif"
      >
        CSS
      </text>
    </Svg>
  );
}

/** HTML — orange */
function HtmlIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#E44D26" />
      <text
        x="8"
        y="8"
        textAnchor="middle"
        fill="white"
        fontSize="5"
        fontWeight="bold"
        fontFamily="system-ui, sans-serif"
      >
        {"</>"}
      </text>
      <text
        x="8"
        y="12.8"
        textAnchor="middle"
        fill="rgba(255,255,255,0.7)"
        fontSize="3.2"
        fontFamily="system-ui, sans-serif"
      >
        HTML
      </text>
    </Svg>
  );
}

/** Markdown — light blue */
function MarkdownIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect
        x="1"
        y="1"
        width="14"
        height="14"
        rx="2"
        fill="transparent"
        stroke="#519aba"
        strokeWidth={1.2}
      />
      <text
        x="8"
        y="11.5"
        textAnchor="middle"
        fill="#519aba"
        fontSize="8"
        fontWeight="bold"
        fontFamily="system-ui, sans-serif"
      >
        M
      </text>
    </Svg>
  );
}

/** YAML — red/pink */
function YamlIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#CB171E" />
      <text
        x="8"
        y="11.2"
        textAnchor="middle"
        fill="white"
        fontSize="5.5"
        fontWeight="bold"
        fontFamily="system-ui, sans-serif"
      >
        YML
      </text>
    </Svg>
  );
}

/** Python — blue/yellow */
function PythonIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#3572A5" />
      <text
        x="8"
        y="11.5"
        textAnchor="middle"
        fill="#FFD845"
        fontSize="9"
        fontWeight="bold"
        fontFamily="system-ui, sans-serif"
      >
        Py
      </text>
    </Svg>
  );
}

/** Go — cyan */
function GoIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#00ADD8" />
      <text
        x="8"
        y="11.5"
        textAnchor="middle"
        fill="white"
        fontSize="8"
        fontWeight="bold"
        fontFamily="system-ui, sans-serif"
      >
        Go
      </text>
    </Svg>
  );
}

/** Rust — dark orange */
function RustIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#CE422B" />
      <text
        x="8"
        y="11.5"
        textAnchor="middle"
        fill="white"
        fontSize="7"
        fontWeight="bold"
        fontFamily="system-ui, sans-serif"
      >
        Rs
      </text>
    </Svg>
  );
}

/** Shell / Bash — dark */
function ShellIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#2b2b2b" />
      <text
        x="8"
        y="8"
        textAnchor="middle"
        fill="#4EC9B0"
        fontSize="7"
        fontWeight="bold"
        fontFamily="monospace"
      >
        {">_"}
      </text>
      <text
        x="8"
        y="13"
        textAnchor="middle"
        fill="rgba(255,255,255,0.5)"
        fontSize="3"
        fontFamily="system-ui, sans-serif"
      >
        SH
      </text>
    </Svg>
  );
}

/** SQL — blue */
function SqlIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#336791" />
      <text
        x="8"
        y="11.5"
        textAnchor="middle"
        fill="white"
        fontSize="6.5"
        fontWeight="bold"
        fontFamily="system-ui, sans-serif"
      >
        SQL
      </text>
    </Svg>
  );
}

/** SVG — orange outline */
function SvgFileIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect
        x="1"
        y="1"
        width="14"
        height="14"
        rx="2"
        fill="transparent"
        stroke="#E88024"
        strokeWidth={1.2}
      />
      <text
        x="8"
        y="11.5"
        textAnchor="middle"
        fill="#E88024"
        fontSize="5.5"
        fontWeight="bold"
        fontFamily="system-ui, sans-serif"
      >
        SVG
      </text>
    </Svg>
  );
}

/** Image files — pink/magenta */
function ImageIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#A550A7" />
      <path
        d="M4 11l2.5-3.5L8.5 10l1.5-2 2 3H4z"
        fill="rgba(255,255,255,0.85)"
      />
      <circle cx="5.5" cy="5.5" r="1.2" fill="rgba(255,255,255,0.85)" />
    </Svg>
  );
}

/** Gitignore — orange/red */
function GitIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#E84D31" />
      <path
        d="M8 3.5a4.5 4.5 0 100 9 4.5 4.5 0 000-9zM6.5 7a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm4.5 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z"
        fill="white"
        fillOpacity={0.9}
      />
    </Svg>
  );
}

/** Env / dotenv — yellow-green */
function EnvIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#4B6C2F" />
      <text
        x="8"
        y="11.5"
        textAnchor="middle"
        fill="#C6E89E"
        fontSize="5.5"
        fontWeight="bold"
        fontFamily="system-ui, sans-serif"
      >
        ENV
      </text>
    </Svg>
  );
}

/** Docker — blue whale */
function DockerIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#2496ED" />
      <text
        x="8"
        y="8"
        textAnchor="middle"
        fill="white"
        fontSize="7"
        fontFamily="system-ui, sans-serif"
      >
        🐳
      </text>
      <text
        x="8"
        y="13"
        textAnchor="middle"
        fill="rgba(255,255,255,0.65)"
        fontSize="2.8"
        fontFamily="system-ui, sans-serif"
      >
        DOCKER
      </text>
    </Svg>
  );
}

/** Lock files — gray */
function LockIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#6b6b6b" />
      <path
        d="M5.5 7V5.5a2.5 2.5 0 015 0V7M5 7h6a1 1 0 011 1v3.5a1 1 0 01-1 1H5a1 1 0 01-1-1V8a1 1 0 011-1z"
        stroke="white"
        strokeWidth={0.8}
        fill="none"
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** TOML — gray/teal */
function TomlIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#607D8B" />
      <text
        x="8"
        y="11.2"
        textAnchor="middle"
        fill="white"
        fontSize="4.5"
        fontWeight="bold"
        fontFamily="system-ui, sans-serif"
      >
        TOML
      </text>
    </Svg>
  );
}

/** GraphQL — pink */
function GraphqlIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#E535AB" />
      <text
        x="8"
        y="11.2"
        textAnchor="middle"
        fill="white"
        fontSize="5"
        fontWeight="bold"
        fontFamily="system-ui, sans-serif"
      >
        GQL
      </text>
    </Svg>
  );
}

/** Prisma — dark teal */
function PrismaIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#0C344B" />
      <path
        d="M8 3l5 9H3l5-9z"
        fill="none"
        stroke="white"
        strokeWidth={1}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** SCSS / SASS — pink */
function ScssIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#CD6799" />
      <text
        x="8"
        y="11.5"
        textAnchor="middle"
        fill="white"
        fontSize="6.5"
        fontWeight="bold"
        fontFamily="system-ui, sans-serif"
      >
        S
      </text>
    </Svg>
  );
}

/** C — blue */
function CIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#5C6BC0" />
      <text
        x="8"
        y="11.5"
        textAnchor="middle"
        fill="white"
        fontSize="9"
        fontWeight="bold"
        fontFamily="system-ui, sans-serif"
      >
        C
      </text>
    </Svg>
  );
}

/** C++ — blue darker */
function CppIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#004482" />
      <text
        x="8"
        y="11.5"
        textAnchor="middle"
        fill="white"
        fontSize="6"
        fontWeight="bold"
        fontFamily="system-ui, sans-serif"
      >
        C++
      </text>
    </Svg>
  );
}

/** C# — green-purple */
function CSharpIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#68217A" />
      <text
        x="8"
        y="11.5"
        textAnchor="middle"
        fill="white"
        fontSize="7.5"
        fontWeight="bold"
        fontFamily="system-ui, sans-serif"
      >
        C#
      </text>
    </Svg>
  );
}

/** Java — red */
function JavaIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#B07219" />
      <text
        x="8"
        y="11.5"
        textAnchor="middle"
        fill="white"
        fontSize="6.5"
        fontWeight="bold"
        fontFamily="system-ui, sans-serif"
      >
        Java
      </text>
    </Svg>
  );
}

/** Ruby — red */
function RubyIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#CC342D" />
      <text
        x="8"
        y="11.5"
        textAnchor="middle"
        fill="white"
        fontSize="7"
        fontWeight="bold"
        fontFamily="system-ui, sans-serif"
      >
        Rb
      </text>
    </Svg>
  );
}

/** PHP — purple */
function PhpIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#777BB4" />
      <text
        x="8"
        y="11.5"
        textAnchor="middle"
        fill="white"
        fontSize="5.5"
        fontWeight="bold"
        fontFamily="system-ui, sans-serif"
      >
        PHP
      </text>
    </Svg>
  );
}

/** Swift — orange */
function SwiftIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#F05138" />
      <text
        x="8"
        y="11.5"
        textAnchor="middle"
        fill="white"
        fontSize="8"
        fontWeight="bold"
        fontFamily="system-ui, sans-serif"
      >
        S
      </text>
    </Svg>
  );
}

/** Kotlin — purple/orange */
function KotlinIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="1" y="1" width="14" height="14" rx="2" fill="#7F52FF" />
      <text
        x="8"
        y="11.5"
        textAnchor="middle"
        fill="white"
        fontSize="8"
        fontWeight="bold"
        fontFamily="system-ui, sans-serif"
      >
        Kt
      </text>
    </Svg>
  );
}

/** Generic fallback file icon — gray */
function GenericFileIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path
        d="M4 1.5h5l3.5 3.5v9.5a1 1 0 01-1 1H4a1 1 0 01-1-1V2.5a1 1 0 011-1z"
        fill="#6b6b6b"
        fillOpacity={0.7}
        stroke="#6b6b6b"
        strokeWidth={0.5}
        strokeLinejoin="round"
      />
      <path d="M9 1.5v3.5h3.5" fill="#8b8b8b" stroke="#6b6b6b" strokeWidth={0.5} strokeLinejoin="round" />
    </Svg>
  );
}

/* ------------------------------------------------------------------ */
/* Extension → icon mapping                                            */
/* ------------------------------------------------------------------ */

const extensionMap: Record<string, (props: IconProps) => React.JSX.Element> = {
  // TypeScript
  ts: TypeScriptIcon,
  mts: TypeScriptIcon,
  cts: TypeScriptIcon,
  tsx: TypeScriptReactIcon,

  // JavaScript
  js: JavaScriptIcon,
  mjs: JavaScriptIcon,
  cjs: JavaScriptIcon,
  jsx: JavaScriptReactIcon,

  // Data / config
  json: JsonIcon,
  jsonc: JsonIcon,
  json5: JsonIcon,

  // Markup
  html: HtmlIcon,
  htm: HtmlIcon,

  // Styles
  css: CssIcon,
  scss: ScssIcon,
  sass: ScssIcon,
  less: CssIcon,

  // Markdown
  md: MarkdownIcon,
  mdx: MarkdownIcon,
  markdown: MarkdownIcon,

  // YAML
  yml: YamlIcon,
  yaml: YamlIcon,

  // Python
  py: PythonIcon,
  pyw: PythonIcon,
  pyi: PythonIcon,

  // Go
  go: GoIcon,

  // Rust
  rs: RustIcon,

  // Shell
  sh: ShellIcon,
  bash: ShellIcon,
  zsh: ShellIcon,
  fish: ShellIcon,

  // SQL
  sql: SqlIcon,

  // SVG
  svg: SvgFileIcon,

  // Images
  png: ImageIcon,
  jpg: ImageIcon,
  jpeg: ImageIcon,
  gif: ImageIcon,
  webp: ImageIcon,
  ico: ImageIcon,
  bmp: ImageIcon,
  avif: ImageIcon,

  // Config
  toml: TomlIcon,

  // GraphQL
  graphql: GraphqlIcon,
  gql: GraphqlIcon,

  // Prisma
  prisma: PrismaIcon,

  // Lock
  lock: LockIcon,

  // C family
  c: CIcon,
  h: CIcon,
  cpp: CppIcon,
  cxx: CppIcon,
  cc: CppIcon,
  hpp: CppIcon,
  cs: CSharpIcon,

  // JVM
  java: JavaIcon,
  kt: KotlinIcon,
  kts: KotlinIcon,

  // Ruby
  rb: RubyIcon,
  rake: RubyIcon,
  gemspec: RubyIcon,

  // PHP
  php: PhpIcon,

  // Swift
  swift: SwiftIcon,
};

/** Well-known filenames that get a specific icon regardless of extension. */
const filenameMap: Record<string, (props: IconProps) => React.JSX.Element> = {
  dockerfile: DockerIcon,
  "docker-compose.yml": DockerIcon,
  "docker-compose.yaml": DockerIcon,
  ".gitignore": GitIcon,
  ".gitattributes": GitIcon,
  ".gitmodules": GitIcon,
  ".env": EnvIcon,
  ".env.local": EnvIcon,
  ".env.development": EnvIcon,
  ".env.production": EnvIcon,
  ".env.test": EnvIcon,
  ".env.example": EnvIcon,
  "cargo.toml": TomlIcon,
  "cargo.lock": LockIcon,
  "package-lock.json": LockIcon,
  "yarn.lock": LockIcon,
  "pnpm-lock.yaml": LockIcon,
  "bun.lock": LockIcon,
  "bun.lockb": LockIcon,
  "gemfile.lock": LockIcon,
};

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/**
 * Return the appropriate icon component for a given filename.
 *
 * @example
 *   getFileIcon("utils.ts", { className: "h-4 w-4" })
 *   getFileIcon("Dockerfile")
 */
export function getFileIcon(filename: string, props: IconProps = {}) {
  const lower = filename.toLowerCase();
  const basename = lower.split("/").pop() ?? lower;

  // Check well-known filenames first
  const byName = filenameMap[basename];
  if (byName) return byName(props);

  // Fall back to extension
  const ext = basename.includes(".") ? basename.split(".").pop() ?? "" : "";
  const byExt = extensionMap[ext];
  if (byExt) return byExt(props);

  return GenericFileIcon(props);
}

/**
 * Convenience wrapper that returns a React element directly.
 * Useful when you need to pass an icon as a ReactNode.
 */
export function FileTypeIcon({
  filename,
  ...rest
}: { filename: string } & IconProps) {
  return getFileIcon(filename, rest);
}

export { GenericFileIcon };
