# Design System

This document defines the visual design system used across the Open Agents web application, particularly for unauthenticated/marketing pages.

## Design Philosophy

The design follows a **dark terminal aesthetic** that reflects the developer-focused, CLI-centric nature of Open Agents. The visual language communicates:

- **Technical credibility** - feels like a tool built by developers, for developers
- **Terminal familiarity** - macOS window chrome, command prompts, monospace typography
- **Modern polish** - glassmorphism, ambient lighting, subtle animations

## Color Palette

### Background Colors

| Token | Value | Usage |
|-------|-------|-------|
| `bg-primary` | `#0a0a0b` | Main page background |
| `bg-card` | `#111113` | Card/panel backgrounds |
| `bg-subtle` | `white/[0.02]` | Subtle surface elevation |
| `bg-hover` | `white/[0.04]` | Hover states |

### Text Colors

| Token | Value | Usage |
|-------|-------|-------|
| `text-primary` | `white` | Headings, primary text |
| `text-secondary` | `white/50` | Body text, descriptions |
| `text-muted` | `white/40` | Secondary descriptions |
| `text-subtle` | `white/30` | Hints, labels, metadata |

### Border Colors

| Token | Value | Usage |
|-------|-------|-------|
| `border-default` | `white/[0.08]` | Card borders, dividers |
| `border-subtle` | `white/[0.06]` | Subtle separators |
| `border-hover` | `white/[0.12]` | Hover state borders |

### Accent Colors

| Token | Value | Usage |
|-------|-------|-------|
| `accent-emerald` | `emerald-400` / `emerald-500` | Success, terminal prompts, status indicators |
| `accent-blue` | `blue-400` / `blue-500` | Links, secondary highlights |
| `accent-violet` | `violet-400` / `violet-500` | Tertiary accents |
| `accent-amber` | `amber-400` | Warnings |

### macOS Window Chrome

| Element | Color |
|---------|-------|
| Close button | `#ff5f57` |
| Minimize button | `#febc2e` |
| Maximize button | `#28c840` |

## Background Effects

### Ambient Glow

Large, blurred gradient orbs that create depth and atmosphere:

```tsx
{/* Primary glow - top center */}
<div className="absolute left-1/2 top-0 h-[600px] w-[1000px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-500/[0.07] blur-[150px]" />

{/* Secondary glow - bottom right */}
<div className="absolute bottom-0 right-0 h-[400px] w-[600px] translate-x-1/4 translate-y-1/4 rounded-full bg-blue-500/[0.05] blur-[120px]" />

{/* Tertiary glow - left */}
<div className="absolute bottom-1/3 left-0 h-[300px] w-[400px] -translate-x-1/2 rounded-full bg-violet-500/[0.04] blur-[100px]" />
```

### Dot Grid Pattern

Subtle dot matrix for texture:

```tsx
<div
  className="pointer-events-none absolute inset-0 opacity-[0.4]"
  style={{
    backgroundImage: "radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1px)",
    backgroundSize: "24px 24px",
  }}
/>
```

### Scanline Effect

Retro CRT-style scanlines for terminal feel:

```tsx
<div
  className="pointer-events-none absolute inset-0 opacity-[0.02]"
  style={{
    backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.03) 2px, rgba(255,255,255,0.03) 4px)",
  }}
/>
```

## Components

### Terminal Window Card

macOS-style window with traffic light controls:

```tsx
<div className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#111113]/80 shadow-2xl shadow-black/20 backdrop-blur-xl">
  {/* Window chrome */}
  <div className="flex items-center gap-2 border-b border-white/[0.06] bg-white/[0.02] px-4 py-3">
    <div className="flex items-center gap-1.5">
      <div className="h-3 w-3 rounded-full bg-[#ff5f57]" />
      <div className="h-3 w-3 rounded-full bg-[#febc2e]" />
      <div className="h-3 w-3 rounded-full bg-[#28c840]" />
    </div>
    <div className="ml-3 flex-1">
      <span className="font-mono text-xs text-white/30">terminal</span>
    </div>
  </div>
  
  {/* Content */}
  <div className="p-5">
    {/* ... */}
  </div>
</div>
```

### Command Prompt

Animated terminal prompt with blinking cursor:

```tsx
<div className="font-mono text-sm">
  <div className="flex items-center gap-2 text-white/40">
    <span className="text-emerald-400">$</span>
    <span>openharness auth login</span>
    <span className="inline-block h-4 w-2 animate-pulse bg-emerald-400/80" />
  </div>
  <div className="mt-2 text-white/30">
    <span className="text-amber-400/80">!</span> Authentication required
  </div>
</div>
```

### Icon Container

Bordered container for icons:

```tsx
<div className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03]">
  <Icon className="h-5 w-5 text-white/60" />
</div>
```

### Primary Button (CTA)

High-contrast white button on dark background:

```tsx
<button className="h-10 w-full border-0 bg-white text-sm font-medium text-black transition-all hover:bg-white/90">
  Sign in with GitHub
</button>
```

### Status Badge

Pill-shaped badge with animated indicators:

```tsx
<div className="inline-flex items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.02] px-4 py-2 backdrop-blur">
  <div className="flex items-center gap-1">
    <div className="h-1.5 w-1.5 rounded-full bg-emerald-400/80" />
    <div className="h-1.5 w-1.5 rounded-full bg-emerald-400/60 animate-pulse" />
    <div className="h-1.5 w-1.5 rounded-full bg-emerald-400/40" />
  </div>
  <span className="text-xs text-white/40">Status text</span>
</div>
```

### Gradient Divider

Horizontal divider that fades at edges:

```tsx
<div className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
```

## Typography

### Headings

- **H1**: `text-4xl sm:text-5xl font-semibold tracking-tight text-white`
- **H2**: `text-lg font-medium tracking-tight text-white`

### Body Text

- **Primary**: `text-base leading-relaxed text-white/50`
- **Secondary**: `text-sm leading-relaxed text-white/40`

### Monospace

- **Code/Terminal**: `font-mono text-sm text-white/60`
- **Labels**: `font-mono text-xs text-white/30`

## Spacing

- Card padding: `p-5` or `p-6`
- Section gaps: `gap-4` to `gap-6`
- Element margins: `mb-2` to `mb-6`

## Shadows

- Card shadow: `shadow-2xl shadow-black/20`
- Deep shadow: `shadow-2xl shadow-black/50`

## Animations

- **Pulse**: `animate-pulse` for cursor blink, status indicators
- **Transitions**: `transition-all` or `transition-colors` for hover states

## Icons

Use inline SVGs for consistency. Common icons:

### Terminal Icon
```tsx
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
  <polyline points="4,17 10,11 4,5" />
  <line x1="12" y1="19" x2="20" y2="19" />
</svg>
```

### Lock Icon
```tsx
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
  <path d="M7 11V7a5 5 0 0110 0v4" />
</svg>
```

### Shield Icon
```tsx
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
</svg>
```

### Cloud Icon
```tsx
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
  <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
</svg>
```

## Usage Guidelines

1. **Consistency**: Use the terminal window card for all prominent UI containers on marketing pages
2. **Hierarchy**: Use ambient glows sparingly - one primary (emerald), one or two secondary (blue/violet)
3. **Text contrast**: Ensure sufficient contrast - primary text at `white`, body at `white/50` minimum
4. **Interactivity**: All interactive elements should have visible hover states
5. **Responsiveness**: Use `sm:` breakpoint modifiers for mobile adaptations
