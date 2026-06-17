# Runtime UI Neo-Brutalist Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Mantine UI with a custom neo-brutalist design system built on React Aria Components + TypeStyles in `apps/runtime-ui`.

**Architecture:** A self-contained design system lives in `apps/runtime-ui/src/ds/`. It exports tokens, styled components, hooks, and a notifications system. All Mantine imports are replaced file-by-file. React Aria Components provides accessibility for interactive elements (Button, inputs, Select, Tabs, Modal, Tooltip); TypeStyles provides CSS-in-TypeScript with CSS custom property tokens. Neo-brutalist aesthetic: 2px black borders, 0 border-radius, offset box-shadows, bold weights.

**Tech Stack:** React 18, TypeScript, TypeStyles (runtime CSS-in-TS), React Aria Components, Vite

---

## File Map

**New files (design system):**
- `src/ds/tokens.ts` — color, space, font tokens
- `src/ds/global.css` — CSS reset + body styles
- `src/ds/hooks.ts` — `useDebouncedValue`, `useDisclosure`
- `src/ds/notifications.tsx` — toast notification system
- `src/ds/components/layout.tsx` — `Box`, `Stack`, `Group`, `SimpleGrid`, `ScrollArea`
- `src/ds/components/text.tsx` — `Text`, `Title`
- `src/ds/components/badge.tsx` — `Badge`
- `src/ds/components/loader.tsx` — `Loader`
- `src/ds/components/surface.tsx` — `Card`, `Paper`, `Alert`, `Divider`
- `src/ds/components/code.tsx` — `Code` (inline + block)
- `src/ds/components/anchor.tsx` — `Anchor`
- `src/ds/components/button.tsx` — `Button`, `UnstyledButton`
- `src/ds/components/input.tsx` — `Textarea`, `TextInput`
- `src/ds/components/select.tsx` — `Select`
- `src/ds/components/tabs.tsx` — `Tabs`
- `src/ds/components/modal.tsx` — `Modal`
- `src/ds/components/tooltip.tsx` — `Tooltip`
- `src/ds/components/progress.tsx` — `Progress`
- `src/ds/components/collapse.tsx` — `Collapse`
- `src/ds/components/app-shell.tsx` — `AppShell`, `NavLink`
- `src/ds/index.ts` — barrel export

**Modified files:**
- `src/main.tsx`
- `src/App.tsx`
- `src/pages/DashboardPage.tsx`
- `src/pages/WorkstreamsPage.tsx`
- `src/pages/WorkstreamDetailPage.tsx`
- `src/pages/BenchPage.tsx`
- `src/pages/BenchRunPage.tsx`
- `src/pages/UsagePage.tsx`
- `src/pages/ModelsPage.tsx`
- `src/pages/MemoriesPage.tsx`
- `src/pages/MessageCostPage.tsx`
- `src/components/StatusBadge.tsx`
- `src/components/MessageComposer.tsx`
- `src/components/UsageStats.tsx`
- `src/components/CallTree.tsx`
- `src/components/BenchTrajectory.tsx`
- `src/components/BreakdownTable.tsx`
- `src/components/TokenSpendChart.tsx`
- `src/components/BenchEfficiencyChart.tsx`
- `src/components/ViewRawLink.tsx`
- `apps/runtime-ui/package.json`

---

## Task 1: Install dependencies

**Files:** `apps/runtime-ui/package.json`

- [ ] **Step 1: Add new packages**

Run from the repo root:
```bash
cd apps/runtime-ui && pnpm add react-aria-components typestyles
```

- [ ] **Step 2: Remove Mantine and postcss packages**

```bash
pnpm remove @mantine/core @mantine/hooks @mantine/notifications postcss-preset-mantine postcss-simple-vars postcss
```

- [ ] **Step 3: Delete PostCSS config**

```bash
rm -f postcss.config.cjs postcss.config.js postcss.config.ts
```

- [ ] **Step 4: Re-install from repo root**

```bash
cd ../.. && pnpm install
```

Expected: no Mantine packages in `apps/runtime-ui/package.json`.

---

## Task 2: Design tokens

**Files:** Create `apps/runtime-ui/src/ds/tokens.ts`

- [ ] **Step 1: Create `src/ds/tokens.ts`**

```typescript
import { tokens } from 'typestyles';

export const color = tokens.create('nb-color', {
  bg: '#ffffff',
  surface: '#f9f8f6',
  border: '#000000',
  text: '#000000',
  muted: '#555555',
  dimmed: '#888888',
  blue: '#2563eb',
  blueLight: '#dbeafe',
  green: '#16a34a',
  greenLight: '#dcfce7',
  red: '#dc2626',
  redLight: '#fee2e2',
  orange: '#ea580c',
  orangeLight: '#ffedd5',
  gray: '#6b7280',
  grayLight: '#f3f4f6',
  grayBg: '#e5e7eb',
  cyan: '#0891b2',
  cyanLight: '#cffafe',
  violet: '#7c3aed',
  violetLight: '#ede9fe',
  indigo: '#4338ca',
  indigoLight: '#e0e7ff',
  teal: '#0f766e',
  tealLight: '#ccfbf1',
  grape: '#9333ea',
  grapeLight: '#f3e8ff',
  yellow: '#ca8a04',
  yellowLight: '#fef9c3',
});

export const space = tokens.create('nb-space', {
  xs: '4px',
  sm: '8px',
  md: '16px',
  lg: '24px',
  xl: '32px',
  xxl: '48px',
});

export const font = tokens.create('nb-font', {
  familySans: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  familyMono: '"Fira Code", "Cascadia Code", Consolas, "Courier New", monospace',
  sizeXs: '11px',
  sizeSm: '13px',
  sizeMd: '14px',
  sizeLg: '16px',
  sizeXl: '20px',
  size2xl: '24px',
  size3xl: '32px',
  size4xl: '40px',
  w400: '400',
  w500: '500',
  w600: '600',
  w700: '700',
  w800: '800',
  w900: '900',
});

// Raw hex values for use in SVG attributes and non-CSS contexts
export const RAW = {
  border: '#000000',
  bg: '#ffffff',
  surface: '#f9f8f6',
  dimmed: '#888888',
  muted: '#555555',
  blue: '#2563eb',
  blueLight: '#dbeafe',
  green: '#16a34a',
  greenLight: '#dcfce7',
  red: '#dc2626',
  redLight: '#fee2e2',
  orange: '#ea580c',
  orangeLight: '#ffedd5',
  gray: '#6b7280',
  grayLight: '#f3f4f6',
  grayBg: '#e5e7eb',
  cyan: '#0891b2',
  cyanLight: '#cffafe',
  violet: '#7c3aed',
  violetLight: '#ede9fe',
  indigo: '#4338ca',
  indigoLight: '#e0e7ff',
  teal: '#0f766e',
  tealLight: '#ccfbf1',
  grape: '#9333ea',
  grapeLight: '#f3e8ff',
  yellow: '#ca8a04',
  yellowLight: '#fef9c3',
} as const;
```

---

## Task 3: Global CSS + update main.tsx

**Files:** Create `src/ds/global.css`, modify `src/main.tsx`

- [ ] **Step 1: Create `src/ds/global.css`**

```css
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html,
body,
#root {
  height: 100%;
}

body {
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: #000;
  background-color: #fff;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

:focus-visible {
  outline: 2px solid #000;
  outline-offset: 2px;
}

a {
  color: inherit;
}

::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: #f3f4f6; }
::-webkit-scrollbar-thumb { background: #000; border: 2px solid #f3f4f6; }

@keyframes nb-spin {
  to { transform: rotate(360deg); }
}

@keyframes nb-fadein {
  from { opacity: 0; transform: translateY(-6px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

- [ ] **Step 2: Rewrite `src/main.tsx`**

```tsx
import './ds/global.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App.tsx';
import { Notifications } from './ds/notifications.tsx';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Notifications />
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
```

---

## Task 4: Layout primitives

**Files:** Create `src/ds/components/layout.tsx`

- [ ] **Step 1: Create `src/ds/components/layout.tsx`**

```tsx
import {
  type CSSProperties,
  type HTMLAttributes,
  forwardRef,
} from 'react';
import { styles, cx } from 'typestyles';
import { space } from '../tokens';

// ── Box ──────────────────────────────────────────────────────────────

export type BoxProps = HTMLAttributes<HTMLDivElement> & {
  component?: React.ElementType;
  w?: number | string;
  h?: number | string;
  maw?: number | string;
  mah?: number | string;
  ml?: number | string;
  mr?: number | string;
  mt?: number | string;
  mb?: number | string;
  p?: number | string;
};

export const Box = forwardRef<HTMLDivElement, BoxProps>(function Box(
  { component: Tag = 'div', w, h, maw, mah, ml, mr, mt, mb, p, style, ...props },
  ref,
) {
  const s: CSSProperties = {
    ...(w !== undefined ? { width: px(w) } : {}),
    ...(h !== undefined ? { height: px(h) } : {}),
    ...(maw !== undefined ? { maxWidth: px(maw) } : {}),
    ...(mah !== undefined ? { maxHeight: px(mah) } : {}),
    ...(ml !== undefined ? { marginLeft: px(ml) } : {}),
    ...(mr !== undefined ? { marginRight: px(mr) } : {}),
    ...(mt !== undefined ? { marginTop: px(mt) } : {}),
    ...(mb !== undefined ? { marginBottom: px(mb) } : {}),
    ...(p !== undefined ? { padding: px(p) } : {}),
    ...style,
  };
  return <Tag ref={ref} style={Object.keys(s).length ? s : undefined} {...props} />;
});

function px(v: number | string): string {
  return typeof v === 'number' ? `${v}px` : v;
}

// ── Stack ─────────────────────────────────────────────────────────────

const stackCls = styles.component('nb-stack', {
  base: { display: 'flex', flexDirection: 'column' },
  variants: {
    gap: {
      xs: { gap: space.xs },
      sm: { gap: space.sm },
      md: { gap: space.md },
      lg: { gap: space.lg },
      xl: { gap: space.xl },
    },
  },
  defaultVariants: { gap: 'md' },
});

type GapKey = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

export type StackProps = HTMLAttributes<HTMLDivElement> & {
  gap?: GapKey | number;
  align?: CSSProperties['alignItems'];
  justify?: CSSProperties['justifyContent'];
};

export const Stack = forwardRef<HTMLDivElement, StackProps>(function Stack(
  { gap = 'md', align, justify, className, style, ...props },
  ref,
) {
  const s: CSSProperties = {
    ...(typeof gap === 'number' ? { gap: `${gap}px` } : {}),
    ...(align ? { alignItems: align } : {}),
    ...(justify ? { justifyContent: justify } : {}),
    ...style,
  };
  const gapCls = typeof gap === 'string' ? stackCls({ gap }) : stackCls({ gap: 'md' });
  return (
    <div
      ref={ref}
      className={cx(gapCls, className)}
      style={Object.keys(s).length ? s : undefined}
      {...props}
    />
  );
});

// ── Group ─────────────────────────────────────────────────────────────

const groupCls = styles.component('nb-group', {
  base: { display: 'flex', flexDirection: 'row', alignItems: 'center' },
  variants: {
    gap: {
      xs: { gap: space.xs },
      sm: { gap: space.sm },
      md: { gap: space.md },
      lg: { gap: space.lg },
      xl: { gap: space.xl },
    },
  },
  defaultVariants: { gap: 'sm' },
});

export type GroupProps = HTMLAttributes<HTMLDivElement> & {
  gap?: GapKey | number;
  align?: CSSProperties['alignItems'];
  justify?: CSSProperties['justifyContent'];
  wrap?: CSSProperties['flexWrap'];
  grow?: boolean;
};

export const Group = forwardRef<HTMLDivElement, GroupProps>(function Group(
  { gap = 'sm', align, justify, wrap, grow, className, style, ...props },
  ref,
) {
  const s: CSSProperties = {
    ...(typeof gap === 'number' ? { gap: `${gap}px` } : {}),
    ...(align ? { alignItems: align } : {}),
    ...(justify ? { justifyContent: justify } : {}),
    ...(wrap ? { flexWrap: wrap } : {}),
    ...(grow ? { '& > *': { flex: 1 } } as CSSProperties : {}),
    ...style,
  };
  const gapCls = typeof gap === 'string' ? groupCls({ gap }) : groupCls({ gap: 'sm' });
  return (
    <div
      ref={ref}
      className={cx(gapCls, className)}
      style={Object.keys(s).length ? s : undefined}
      {...props}
    />
  );
});

// ── SimpleGrid ────────────────────────────────────────────────────────

type ColsInput =
  | number
  | { base?: number; sm?: number; md?: number; lg?: number; xl?: number };

export type SimpleGridProps = HTMLAttributes<HTMLDivElement> & {
  cols?: ColsInput;
  spacing?: GapKey | number;
};

export const SimpleGrid = forwardRef<HTMLDivElement, SimpleGridProps>(
  function SimpleGrid({ cols = 1, spacing = 'md', style, ...props }, ref) {
    const colCount = typeof cols === 'number' ? cols : (cols.lg ?? cols.md ?? cols.sm ?? cols.base ?? 1);
    const gap = typeof spacing === 'string' ? `var(--nb-space-${spacing})` : `${spacing}px`;
    return (
      <div
        ref={ref}
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))`,
          gap,
          ...style,
        }}
        {...props}
      />
    );
  },
);

// ── ScrollArea ─────────────────────────────────────────────────────────

const scrollCls = styles.class('nb-scroll-area', { overflow: 'auto' });

export type ScrollAreaProps = HTMLAttributes<HTMLDivElement> & {
  type?: string;
  mah?: number | string;
};

function ScrollAreaBase(
  { mah, style, className, ...props }: ScrollAreaProps,
  ref: React.Ref<HTMLDivElement>,
) {
  return (
    <div
      ref={ref}
      className={cx(scrollCls, className)}
      style={{ ...(mah !== undefined ? { maxHeight: px(mah) } : {}), ...style }}
      {...props}
    />
  );
}

const ScrollAreaForwardRef = forwardRef<HTMLDivElement, ScrollAreaProps>(ScrollAreaBase);

export const ScrollArea = Object.assign(ScrollAreaForwardRef, {
  Autosize: ScrollAreaForwardRef,
});
```

---

## Task 5: Typography

**Files:** Create `src/ds/components/text.tsx`

- [ ] **Step 1: Create `src/ds/components/text.tsx`**

```tsx
import { type CSSProperties, type HTMLAttributes, forwardRef } from 'react';
import { styles, cx } from 'typestyles';
import { color, font } from '../tokens';

const textCls = styles.component('nb-text', {
  base: {
    fontFamily: font.familySans,
    fontSize: font.sizeMd,
    color: color.text,
    lineHeight: '1.5',
  },
  variants: {
    size: {
      xs: { fontSize: font.sizeXs },
      sm: { fontSize: font.sizeSm },
      md: { fontSize: font.sizeMd },
      lg: { fontSize: font.sizeLg },
      xl: { fontSize: font.sizeXl },
    },
    c: {
      dimmed:  { color: color.dimmed },
      muted:   { color: color.muted },
      red:     { color: color.red },
      green:   { color: color.green },
      blue:    { color: color.blue },
      orange:  { color: color.orange },
      cyan:    { color: color.cyan },
      violet:  { color: color.violet },
      grape:   { color: color.grape },
      teal:    { color: color.teal },
      indigo:  { color: color.indigo },
      gray:    { color: color.gray },
      inherit: { color: 'inherit' },
    },
    upper: {
      true: { textTransform: 'uppercase', letterSpacing: '0.05em' },
    },
    mono: {
      true: { fontFamily: font.familyMono },
    },
  },
  defaultVariants: { size: 'md' },
});

type TextColor =
  | 'dimmed' | 'muted' | 'red' | 'green' | 'blue' | 'orange'
  | 'cyan' | 'violet' | 'grape' | 'teal' | 'indigo' | 'gray' | 'inherit';

export type TextProps = HTMLAttributes<HTMLElement> & {
  component?: React.ElementType;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  c?: TextColor;
  fw?: number;
  fz?: number | string;
  lh?: number | string;
  tt?: 'uppercase' | 'lowercase' | 'capitalize';
  ff?: 'monospace' | string;
  lineClamp?: number;
  ta?: 'left' | 'right' | 'center';
  w?: number | string;
  maw?: number | string;
  mt?: number | string;
  mb?: number | string;
};

export const Text = forwardRef<HTMLElement, TextProps>(function Text(
  {
    component: Tag = 'span',
    size = 'md',
    c,
    fw,
    fz,
    lh,
    tt,
    ff,
    lineClamp,
    ta,
    w,
    maw,
    mt,
    mb,
    className,
    style,
    ...props
  },
  ref,
) {
  const cls = textCls({
    size,
    c: c as any,
    upper: tt === 'uppercase' ? 'true' : undefined,
    mono: ff === 'monospace' ? 'true' : undefined,
  });

  const s: CSSProperties = {
    ...(fw ? { fontWeight: fw } : {}),
    ...(fz ? { fontSize: typeof fz === 'number' ? `${fz}px` : fz } : {}),
    ...(lh ? { lineHeight: lh } : {}),
    ...(tt && tt !== 'uppercase' ? { textTransform: tt } : {}),
    ...(ff && ff !== 'monospace' ? { fontFamily: ff } : {}),
    ...(lineClamp ? { display: '-webkit-box', WebkitLineClamp: lineClamp, WebkitBoxOrient: 'vertical', overflow: 'hidden' } : {}),
    ...(ta ? { textAlign: ta } : {}),
    ...(w !== undefined ? { width: typeof w === 'number' ? `${w}px` : w } : {}),
    ...(maw !== undefined ? { maxWidth: typeof maw === 'number' ? `${maw}px` : maw } : {}),
    ...(mt !== undefined ? { marginTop: typeof mt === 'number' ? `${mt}px` : mt } : {}),
    ...(mb !== undefined ? { marginBottom: typeof mb === 'number' ? `${mb}px` : mb } : {}),
    ...style,
  };

  return (
    <Tag
      ref={ref}
      className={cx(cls, className)}
      style={Object.keys(s).length ? s : undefined}
      {...props}
    />
  );
});

// ── Title ─────────────────────────────────────────────────────────────

const titleCls = styles.component('nb-title', {
  base: {
    fontFamily: font.familySans,
    fontWeight: font.w700,
    color: color.text,
    lineHeight: '1.2',
  },
  variants: {
    order: {
      '1': { fontSize: font.size4xl },
      '2': { fontSize: font.size3xl },
      '3': { fontSize: font.size2xl },
      '4': { fontSize: font.sizeXl },
      '5': { fontSize: font.sizeLg, fontWeight: font.w600 },
      '6': { fontSize: font.sizeMd, fontWeight: font.w600 },
    },
  },
  defaultVariants: { order: '3' },
});

const TAG_FOR_ORDER: Record<number, React.ElementType> = {
  1: 'h1', 2: 'h2', 3: 'h3', 4: 'h4', 5: 'h5', 6: 'h6',
};

export type TitleProps = HTMLAttributes<HTMLHeadingElement> & {
  order?: 1 | 2 | 3 | 4 | 5 | 6;
};

export const Title = forwardRef<HTMLHeadingElement, TitleProps>(function Title(
  { order = 3, className, ...props },
  ref,
) {
  const Tag = TAG_FOR_ORDER[order];
  return (
    <Tag
      ref={ref}
      className={cx(titleCls({ order: String(order) as any }), className)}
      {...props}
    />
  );
});
```

---

## Task 6: Badge + Loader

**Files:** Create `src/ds/components/badge.tsx`, `src/ds/components/loader.tsx`

- [ ] **Step 1: Create `src/ds/components/badge.tsx`**

```tsx
import { type HTMLAttributes, forwardRef } from 'react';
import { styles, cx } from 'typestyles';
import { color, font } from '../tokens';

const badgeCls = styles.component('nb-badge', {
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    fontFamily: font.familySans,
    fontSize: font.sizeXs,
    fontWeight: font.w600,
    letterSpacing: '0.03em',
    textTransform: 'uppercase',
    padding: '2px 7px',
    border: `1px solid ${color.border}`,
    borderRadius: '0',
    lineHeight: '1.4',
    whiteSpace: 'nowrap',
  },
  variants: {
    color: {
      gray:   { background: color.grayLight,   color: color.gray,   borderColor: color.gray },
      blue:   { background: color.blueLight,   color: color.blue,   borderColor: color.blue },
      green:  { background: color.greenLight,  color: color.green,  borderColor: color.green },
      red:    { background: color.redLight,    color: color.red,    borderColor: color.red },
      orange: { background: color.orangeLight, color: color.orange, borderColor: color.orange },
      cyan:   { background: color.cyanLight,   color: color.cyan,   borderColor: color.cyan },
      violet: { background: color.violetLight, color: color.violet, borderColor: color.violet },
      indigo: { background: color.indigoLight, color: color.indigo, borderColor: color.indigo },
      teal:   { background: color.tealLight,   color: color.teal,   borderColor: color.teal },
      grape:  { background: color.grapeLight,  color: color.grape,  borderColor: color.grape },
      yellow: { background: color.yellowLight, color: color.yellow, borderColor: color.yellow },
    },
    variant: {
      filled:  { background: color.border, color: color.bg, borderColor: color.border },
      light:   {},
      outline: { background: 'transparent' },
      dot:     { paddingLeft: '14px', position: 'relative' },
    },
    size: {
      xs: { fontSize: '10px', padding: '1px 5px' },
      sm: { fontSize: font.sizeXs },
      md: { fontSize: font.sizeSm },
      lg: { fontSize: font.sizeMd, padding: '3px 10px' },
    },
  },
  defaultVariants: { color: 'gray', variant: 'light', size: 'sm' },
});

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  color?: 'gray' | 'blue' | 'green' | 'red' | 'orange' | 'cyan' | 'violet' | 'indigo' | 'teal' | 'grape' | 'yellow';
  variant?: 'filled' | 'light' | 'outline' | 'dot';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  radius?: string;
  ml?: number;
};

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { color: c = 'gray', variant = 'light', size = 'sm', radius, ml, className, style, ...props },
  ref,
) {
  return (
    <span
      ref={ref}
      className={cx(badgeCls({ color: c, variant, size }), className)}
      style={{ ...(ml ? { marginLeft: `${ml}px` } : {}), ...style }}
      {...props}
    />
  );
});
```

- [ ] **Step 2: Create `src/ds/components/loader.tsx`**

```tsx
import { type HTMLAttributes } from 'react';
import { styles, cx } from 'typestyles';
import { color } from '../tokens';

const loaderCls = styles.component('nb-loader', {
  base: {
    display: 'inline-block',
    width: '20px',
    height: '20px',
    border: `3px solid ${color.grayBg}`,
    borderTopColor: color.border,
    borderRadius: '50%',
    animation: 'nb-spin 0.7s linear infinite',
  },
  variants: {
    size: {
      xs: { width: '12px', height: '12px', borderWidth: '2px' },
      sm: { width: '16px', height: '16px', borderWidth: '2px' },
      md: { width: '20px', height: '20px' },
      lg: { width: '28px', height: '28px', borderWidth: '4px' },
    },
  },
  defaultVariants: { size: 'md' },
});

export type LoaderProps = HTMLAttributes<HTMLDivElement> & {
  size?: 'xs' | 'sm' | 'md' | 'lg';
};

export function Loader({ size = 'md', className, ...props }: LoaderProps) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={cx(loaderCls({ size }), className)}
      {...props}
    />
  );
}
```

---

## Task 7: Card, Paper, Alert, Divider

**Files:** Create `src/ds/components/surface.tsx`

- [ ] **Step 1: Create `src/ds/components/surface.tsx`**

```tsx
import { type CSSProperties, type HTMLAttributes, type ReactNode, forwardRef } from 'react';
import { styles, cx } from 'typestyles';
import { color, font, space } from '../tokens';

// ── Paper ─────────────────────────────────────────────────────────────

const paperCls = styles.component('nb-paper', {
  base: {
    background: color.bg,
    border: `2px solid ${color.border}`,
    borderRadius: '0',
    boxShadow: `3px 3px 0 0 ${color.border}`,
  },
  variants: {
    p: {
      xs: { padding: space.xs },
      sm: { padding: space.sm },
      md: { padding: space.md },
      lg: { padding: space.lg },
      xl: { padding: space.xl },
    },
  },
  defaultVariants: { p: 'md' },
});

export type PaperProps = HTMLAttributes<HTMLDivElement> & {
  withBorder?: boolean;
  radius?: string;
  p?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | string;
  bg?: string;
  maw?: number | string;
  component?: React.ElementType;
};

export const Paper = forwardRef<HTMLDivElement, PaperProps>(function Paper(
  { withBorder = true, p = 'md', bg, maw, component: Tag = 'div', className, style, ...props },
  ref,
) {
  const pKey = ['xs', 'sm', 'md', 'lg', 'xl'].includes(p as string) ? p as any : 'md';
  const s: CSSProperties = {
    ...(bg ? { background: bg } : {}),
    ...(maw !== undefined ? { maxWidth: typeof maw === 'number' ? `${maw}px` : maw } : {}),
    ...(p && !['xs', 'sm', 'md', 'lg', 'xl'].includes(p as string) ? { padding: p } : {}),
    ...style,
  };
  return (
    <Tag
      ref={ref}
      className={cx(paperCls({ p: pKey }), className)}
      style={Object.keys(s).length ? s : undefined}
      {...props}
    />
  );
});

// ── Card ──────────────────────────────────────────────────────────────

export type CardProps = PaperProps & {
  padding?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
};

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { padding, p, ...props },
  ref,
) {
  return <Paper ref={ref} p={padding ?? p ?? 'md'} {...props} />;
});

// ── Alert ─────────────────────────────────────────────────────────────

const alertCls = styles.component('nb-alert', {
  base: {
    padding: space.md,
    border: `2px solid ${color.border}`,
    borderRadius: '0',
    fontSize: font.sizeMd,
    fontFamily: font.familySans,
  },
  variants: {
    color: {
      gray:   { background: color.grayLight,   borderLeftColor: color.gray,   borderLeftWidth: '4px' },
      blue:   { background: color.blueLight,   borderLeftColor: color.blue,   borderLeftWidth: '4px' },
      green:  { background: color.greenLight,  borderLeftColor: color.green,  borderLeftWidth: '4px' },
      red:    { background: color.redLight,    borderLeftColor: color.red,    borderLeftWidth: '4px' },
      orange: { background: color.orangeLight, borderLeftColor: color.orange, borderLeftWidth: '4px' },
    },
  },
  defaultVariants: { color: 'blue' },
});

export type AlertProps = HTMLAttributes<HTMLDivElement> & {
  color?: 'gray' | 'blue' | 'green' | 'red' | 'orange';
  title?: ReactNode;
  variant?: string;
  icon?: ReactNode;
};

export function Alert({ color: c = 'blue', title, icon, variant, className, children, ...props }: AlertProps) {
  return (
    <div className={cx(alertCls({ color: c }), className)} {...props}>
      {(title || icon) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, marginBottom: children ? '6px' : 0 }}>
          {icon}
          {title}
        </div>
      )}
      {children}
    </div>
  );
}

// ── Divider ───────────────────────────────────────────────────────────

const dividerCls = styles.class('nb-divider', {
  display: 'block',
  height: '2px',
  background: color.border,
  border: 'none',
  margin: `${space.sm} 0`,
});

export function Divider({ className, ...props }: HTMLAttributes<HTMLHRElement>) {
  return <hr className={cx(dividerCls, className)} {...props} />;
}
```

---

## Task 8: Code + Anchor

**Files:** Create `src/ds/components/code.tsx`, `src/ds/components/anchor.tsx`

- [ ] **Step 1: Create `src/ds/components/code.tsx`**

```tsx
import { type HTMLAttributes, forwardRef } from 'react';
import { styles, cx } from 'typestyles';
import { color, font } from '../tokens';

const inlineCls = styles.class('nb-code-inline', {
  fontFamily: font.familyMono,
  fontSize: '0.88em',
  background: color.grayLight,
  border: `1px solid ${color.grayBg}`,
  borderRadius: '0',
  padding: '1px 5px',
  color: color.text,
});

const blockCls = styles.class('nb-code-block', {
  fontFamily: font.familyMono,
  fontSize: font.sizeSm,
  background: color.grayLight,
  border: `2px solid ${color.border}`,
  borderRadius: '0',
  padding: '12px 16px',
  overflowX: 'auto',
  display: 'block',
  whiteSpace: 'pre-wrap',
  color: color.text,
});

export type CodeProps = HTMLAttributes<HTMLElement> & {
  block?: boolean;
  c?: string;
};

export const Code = forwardRef<HTMLElement, CodeProps>(function Code(
  { block, c, className, style, ...props },
  ref,
) {
  if (block) {
    return (
      <code
        ref={ref}
        className={cx(blockCls, className)}
        style={{ ...(c ? { color: c } : {}), ...style }}
        {...props}
      />
    );
  }
  return (
    <code
      ref={ref}
      className={cx(inlineCls, className)}
      style={{ ...(c ? { color: c } : {}), ...style }}
      {...props}
    />
  );
});
```

- [ ] **Step 2: Create `src/ds/components/anchor.tsx`**

```tsx
import { type AnchorHTMLAttributes, forwardRef } from 'react';
import { styles, cx } from 'typestyles';
import { color, font } from '../tokens';

const anchorCls = styles.component('nb-anchor', {
  base: {
    color: color.blue,
    textDecoration: 'underline',
    textDecorationThickness: '2px',
    fontFamily: font.familySans,
    cursor: 'pointer',
    '&:hover': { color: color.indigo },
  },
  variants: {
    size: {
      xs: { fontSize: font.sizeXs },
      sm: { fontSize: font.sizeSm },
      md: { fontSize: font.sizeMd },
    },
    c: {
      dimmed:  { color: color.dimmed },
      inherit: { color: 'inherit' },
    },
  },
  defaultVariants: { size: 'md' },
});

export type AnchorProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  component?: React.ElementType;
  size?: 'xs' | 'sm' | 'md';
  c?: 'dimmed' | 'inherit';
  download?: string;
};

export const Anchor = forwardRef<HTMLAnchorElement, AnchorProps>(function Anchor(
  { component: Tag = 'a', size = 'md', c, className, ...props },
  ref,
) {
  return (
    <Tag
      ref={ref}
      className={cx(anchorCls({ size, c: c as any }), className)}
      {...props}
    />
  );
});
```

---

## Task 9: Collapse + Progress

**Files:** Create `src/ds/components/collapse.tsx`, `src/ds/components/progress.tsx`

- [ ] **Step 1: Create `src/ds/components/collapse.tsx`**

```tsx
import { type ReactNode } from 'react';
import { styles } from 'typestyles';

const collapseCls = styles.component('nb-collapse', {
  base: { overflow: 'hidden', transition: 'max-height 200ms ease, opacity 200ms ease' },
  variants: {
    open: {
      true:  { maxHeight: '10000px', opacity: '1' },
      false: { maxHeight: '0px',     opacity: '0' },
    },
  },
  defaultVariants: { open: 'false' },
});

export type CollapseProps = {
  in: boolean;
  children: ReactNode;
};

export function Collapse({ in: open, children }: CollapseProps) {
  return (
    <div className={collapseCls({ open: open ? 'true' : 'false' })}>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Create `src/ds/components/progress.tsx`**

```tsx
import { type HTMLAttributes } from 'react';
import { styles } from 'typestyles';
import { color } from '../tokens';

const trackCls = styles.class('nb-progress-track', {
  width: '100%',
  height: '12px',
  background: color.grayLight,
  border: `2px solid ${color.border}`,
  borderRadius: '0',
  overflow: 'hidden',
});

const barCls = styles.class('nb-progress-bar', {
  height: '100%',
  background: color.blue,
  transition: 'width 300ms ease',
});

export type ProgressProps = HTMLAttributes<HTMLDivElement> & {
  value: number;
  color?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  radius?: string;
};

export function Progress({ value, color: c, size, radius, style, ...props }: ProgressProps) {
  const heightMap = { xs: '6px', sm: '8px', md: '12px', lg: '16px' };
  const h = size ? heightMap[size] : '12px';
  return (
    <div className={trackCls} style={{ height: h, ...style }} {...props}>
      <div
        className={barCls}
        style={{ width: `${Math.min(100, Math.max(0, value))}%`, ...(c ? { background: c } : {}) }}
      />
    </div>
  );
}
```

---

## Task 10: Button + UnstyledButton

**Files:** Create `src/ds/components/button.tsx`

- [ ] **Step 1: Create `src/ds/components/button.tsx`**

```tsx
import { type ReactNode, forwardRef } from 'react';
import {
  Button as AriaButton,
  type ButtonProps as AriaButtonProps,
} from 'react-aria-components';
import { styles, cx } from 'typestyles';
import { color, font, space } from '../tokens';

const btnCls = styles.component('nb-button', {
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    fontFamily: font.familySans,
    fontWeight: font.w700,
    cursor: 'pointer',
    border: `2px solid ${color.border}`,
    borderRadius: '0',
    background: color.bg,
    color: color.text,
    boxShadow: `3px 3px 0 0 ${color.border}`,
    transition: 'transform 80ms, box-shadow 80ms',
    textDecoration: 'none',
    whiteSpace: 'nowrap',
    userSelect: 'none',
    '&[data-pressed]':  { transform: 'translate(2px, 2px)', boxShadow: `1px 1px 0 0 ${color.border}` },
    '&[data-hovered]':  { background: color.grayLight },
    '&[data-disabled]': { opacity: 0.4, cursor: 'not-allowed', boxShadow: 'none', pointerEvents: 'none' },
    '&[data-focused]':  { outline: `2px solid ${color.border}`, outlineOffset: '2px' },
  },
  variants: {
    variant: {
      filled:  {
        background: color.border,
        color: color.bg,
        '&[data-hovered]': { background: '#222' },
      },
      light:   { background: color.grayLight, boxShadow: 'none', '&[data-hovered]': { background: color.grayBg } },
      default: {},
      subtle:  { border: '2px solid transparent', boxShadow: 'none', '&[data-hovered]': { background: color.grayLight, borderColor: color.grayBg } },
      outline: { background: 'transparent' },
    },
    size: {
      xs: { padding: '3px 8px',  fontSize: font.sizeXs },
      sm: { padding: '5px 10px', fontSize: font.sizeSm },
      md: { padding: '7px 14px', fontSize: font.sizeMd },
      lg: { padding: '9px 18px', fontSize: font.sizeLg },
    },
  },
  defaultVariants: { variant: 'default', size: 'md' },
});

export type ButtonProps = Omit<AriaButtonProps, 'className' | 'children'> & {
  variant?: 'filled' | 'light' | 'default' | 'subtle' | 'outline';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  loading?: boolean;
  leftSection?: ReactNode;
  className?: string;
  children?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'md', loading, leftSection, children, className, isDisabled, ...props },
  ref,
) {
  return (
    <AriaButton
      ref={ref}
      className={cx(btnCls({ variant, size }), className)}
      isDisabled={isDisabled || loading}
      {...props}
    >
      {loading ? <span style={{ animation: 'nb-spin 0.7s linear infinite', display: 'inline-block', width: 14, height: 14, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%' }} /> : leftSection}
      {children}
    </AriaButton>
  );
});

// ── UnstyledButton ────────────────────────────────────────────────────

const unstyledCls = styles.class('nb-unstyled-button', {
  background: 'none',
  border: 'none',
  padding: '0',
  cursor: 'pointer',
  font: 'inherit',
  color: 'inherit',
  display: 'inline-flex',
  alignItems: 'center',
  '&[data-focused]': { outline: `2px solid ${color.border}`, outlineOffset: '2px' },
});

export type UnstyledButtonProps = Omit<AriaButtonProps, 'className' | 'children'> & {
  className?: string;
  children?: ReactNode;
  style?: React.CSSProperties;
};

export function UnstyledButton({ className, ...props }: UnstyledButtonProps) {
  return <AriaButton className={cx(unstyledCls, className)} {...props} />;
}
```

---

## Task 11: TextInput + Textarea

**Files:** Create `src/ds/components/input.tsx`

- [ ] **Step 1: Create `src/ds/components/input.tsx`**

```tsx
import { type ReactNode, forwardRef } from 'react';
import {
  TextField as AriaTextField,
  Input as AriaInput,
  TextArea as AriaTextArea,
  Label,
  FieldError,
} from 'react-aria-components';
import { styles, cx } from 'typestyles';
import { color, font, space } from '../tokens';

const inputBaseCls = styles.class('nb-input-base', {
  fontFamily: font.familySans,
  fontSize: font.sizeMd,
  color: color.text,
  background: color.bg,
  border: `2px solid ${color.border}`,
  borderRadius: '0',
  padding: `${space.xs} ${space.sm}`,
  width: '100%',
  outline: 'none',
  boxShadow: `2px 2px 0 0 ${color.border}`,
  '&:focus': { boxShadow: `3px 3px 0 0 ${color.border}`, outline: `2px solid ${color.border}`, outlineOffset: '2px' },
  '&::placeholder': { color: color.dimmed },
});

const textareaCls = styles.class('nb-textarea', {
  fontFamily: font.familySans,
  fontSize: font.sizeMd,
  color: color.text,
  background: color.bg,
  border: `2px solid ${color.border}`,
  borderRadius: '0',
  padding: space.sm,
  width: '100%',
  outline: 'none',
  resize: 'vertical',
  boxShadow: `2px 2px 0 0 ${color.border}`,
  '&:focus': { boxShadow: `3px 3px 0 0 ${color.border}`, outline: `2px solid ${color.border}`, outlineOffset: '2px' },
  '&::placeholder': { color: color.dimmed },
});

// ── TextInput ─────────────────────────────────────────────────────────

export type TextInputProps = {
  label?: ReactNode;
  placeholder?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  leftSection?: ReactNode;
  'aria-label'?: string;
  className?: string;
  autoFocus?: boolean;
  name?: string;
  type?: string;
};

export function TextInput({ label, leftSection, className, onChange, ...props }: TextInputProps) {
  return (
    <AriaTextField onChange={onChange} style={{ position: 'relative' }}>
      {label && <Label style={{ display: 'block', fontSize: font.sizeSm, fontWeight: 600, marginBottom: '4px' }}>{label}</Label>}
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        {leftSection && (
          <span style={{ position: 'absolute', left: '8px', color: color.dimmed, display: 'flex', pointerEvents: 'none' }}>
            {leftSection}
          </span>
        )}
        <AriaInput
          className={cx(inputBaseCls, className)}
          style={leftSection ? { paddingLeft: '30px' } : undefined}
          {...props}
        />
      </div>
    </AriaTextField>
  );
}

// ── Textarea ──────────────────────────────────────────────────────────

export type TextareaProps = {
  placeholder?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  autosize?: boolean;
  minRows?: number;
  maxRows?: number;
  className?: string;
};

export function Textarea({ autosize, minRows = 3, maxRows, className, ...props }: TextareaProps) {
  return (
    <AriaTextField>
      <AriaTextArea
        rows={minRows}
        className={cx(textareaCls, className)}
        style={maxRows ? { maxHeight: `${maxRows * 1.5 * 14}px` } : undefined}
        {...props}
      />
    </AriaTextField>
  );
}
```

---

## Task 12: Select

**Files:** Create `src/ds/components/select.tsx`

- [ ] **Step 1: Create `src/ds/components/select.tsx`**

```tsx
import { type ReactNode } from 'react';
import {
  Button as AriaButton,
  Label,
  ListBox,
  ListBoxItem,
  ListBoxSection,
  Header,
  Popover,
  Select as AriaSelect,
  SelectValue,
} from 'react-aria-components';
import { styles } from 'typestyles';
import { color, font, space } from '../tokens';

const selectCls = {
  root: styles.class('nb-select-root', { display: 'flex', flexDirection: 'column', gap: space.xs }),
  label: styles.class('nb-select-label', { fontSize: font.sizeSm, fontWeight: font.w600, display: 'block' }),
  trigger: styles.class('nb-select-trigger', {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    padding: `${space.xs} ${space.sm}`,
    background: color.bg,
    border: `2px solid ${color.border}`,
    borderRadius: '0',
    boxShadow: `2px 2px 0 0 ${color.border}`,
    fontFamily: font.familySans,
    fontSize: font.sizeMd,
    cursor: 'pointer',
    minWidth: '200px',
    width: '100%',
    '&[data-hovered]': { background: color.grayLight },
    '&[data-focused]': { outline: `2px solid ${color.border}`, outlineOffset: '2px' },
  }),
  popover: styles.class('nb-select-popover', {
    background: color.bg,
    border: `2px solid ${color.border}`,
    borderRadius: '0',
    boxShadow: `4px 4px 0 0 ${color.border}`,
    animation: 'nb-fadein 120ms ease',
    minWidth: 'var(--trigger-width)',
    zIndex: 1000,
    maxHeight: '300px',
    overflow: 'auto',
  }),
  item: styles.class('nb-select-item', {
    padding: `${space.xs} ${space.sm}`,
    fontFamily: font.familySans,
    fontSize: font.sizeMd,
    cursor: 'pointer',
    outline: 'none',
    '&[data-focused]': { background: color.grayLight },
    '&[data-selected]': { background: color.border, color: color.bg },
  }),
  section: styles.class('nb-select-section', {
    padding: `${space.xs} ${space.sm}`,
    fontSize: font.sizeXs,
    fontWeight: font.w700,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: color.dimmed,
    borderTop: `1px solid ${color.grayBg}`,
  }),
};

type SelectItem = { value: string; label: string };
type SelectGroup = { group: string; items: SelectItem[] };
type SelectData = (SelectItem | SelectGroup)[];

export type SelectProps = {
  label?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string | null) => void;
  data: SelectData;
  searchable?: boolean;
  allowDeselect?: boolean;
  placeholder?: string;
  'aria-label'?: string;
  renderOption?: (opts: { option: SelectItem }) => ReactNode;
  disabled?: boolean;
};

function isGroup(item: SelectItem | SelectGroup): item is SelectGroup {
  return 'group' in item;
}

export function Select({
  label,
  value,
  defaultValue,
  onChange,
  data,
  placeholder = 'Select…',
  renderOption,
  disabled,
  'aria-label': ariaLabel,
}: SelectProps) {
  const hasGroups = data.some(isGroup);

  return (
    <AriaSelect
      selectedKey={value}
      defaultSelectedKey={defaultValue}
      onSelectionChange={(key) => onChange?.(key ? String(key) : null)}
      isDisabled={disabled}
      aria-label={ariaLabel}
      className={selectCls.root}
    >
      {label && <Label className={selectCls.label}>{label}</Label>}
      <AriaButton className={selectCls.trigger}>
        <SelectValue>{({ defaultChildren }) => defaultChildren ?? placeholder}</SelectValue>
        <span aria-hidden>▾</span>
      </AriaButton>
      <Popover className={selectCls.popover}>
        <ListBox>
          {hasGroups
            ? (data as SelectGroup[]).map((group) => (
                <ListBoxSection key={group.group}>
                  <Header className={selectCls.section}>{group.group}</Header>
                  {group.items.map((item) => (
                    <ListBoxItem key={item.value} id={item.value} textValue={item.label} className={selectCls.item}>
                      {renderOption ? renderOption({ option: item }) : item.label}
                    </ListBoxItem>
                  ))}
                </ListBoxSection>
              ))
            : (data as SelectItem[]).map((item) => (
                <ListBoxItem key={item.value} id={item.value} textValue={item.label} className={selectCls.item}>
                  {renderOption ? renderOption({ option: item }) : item.label}
                </ListBoxItem>
              ))}
        </ListBox>
      </Popover>
    </AriaSelect>
  );
}
```

---

## Task 13: Tabs

**Files:** Create `src/ds/components/tabs.tsx`

- [ ] **Step 1: Create `src/ds/components/tabs.tsx`**

```tsx
import { type HTMLAttributes, type ReactNode, createContext, useContext, useState } from 'react';
import {
  Tab,
  TabList as AriaTabList,
  TabPanel,
  Tabs as AriaTabs,
} from 'react-aria-components';
import { styles, cx } from 'typestyles';
import { color, font, space } from '../tokens';

const tabsCls = {
  root: styles.class('nb-tabs-root', { width: '100%' }),
  list: styles.class('nb-tabs-list', {
    display: 'flex',
    borderBottom: `2px solid ${color.border}`,
    gap: '0',
  }),
  tab: styles.class('nb-tabs-tab', {
    padding: `${space.sm} ${space.md}`,
    fontFamily: font.familySans,
    fontSize: font.sizeMd,
    fontWeight: font.w600,
    cursor: 'pointer',
    background: 'transparent',
    border: 'none',
    borderBottom: '3px solid transparent',
    marginBottom: '-2px',
    outline: 'none',
    color: color.muted,
    transition: 'color 100ms, border-color 100ms',
    '&[data-selected]': { color: color.text, borderBottomColor: color.border },
    '&[data-hovered]':  { color: color.text, background: color.grayLight },
    '&[data-focused]':  { outline: `2px solid ${color.border}`, outlineOffset: '-2px' },
  }),
  panel: styles.class('nb-tabs-panel', { paddingTop: space.md, outline: 'none' }),
};

// Mantine-compatible Tabs API: <Tabs defaultValue><Tabs.List><Tabs.Tab value><Tabs.Panel value>

type TabsContextValue = { selected: string; setSelected: (v: string) => void };
const TabsContext = createContext<TabsContextValue | null>(null);

export type TabsProps = {
  defaultValue?: string;
  value?: string;
  onTabChange?: (value: string) => void;
  keepMounted?: boolean;
  children: ReactNode;
  className?: string;
};

function TabsRoot({ defaultValue = '', value, onTabChange, children, className }: TabsProps) {
  const [internal, setInternal] = useState(defaultValue);
  const selected = value ?? internal;
  const setSelected = (v: string) => {
    setInternal(v);
    onTabChange?.(v);
  };
  return (
    <TabsContext.Provider value={{ selected, setSelected }}>
      <AriaTabs
        selectedKey={selected}
        onSelectionChange={(key) => setSelected(String(key))}
        className={cx(tabsCls.root, className)}
      >
        {children}
      </AriaTabs>
    </TabsContext.Provider>
  );
}

type TabsListProps = { children: ReactNode; className?: string };
function TabsList({ children, className }: TabsListProps) {
  return <AriaTabList className={cx(tabsCls.list, className)}>{children}</AriaTabList>;
}

type TabsTabProps = { value: string; children: ReactNode; className?: string };
function TabsTab({ value, children, className }: TabsTabProps) {
  return <Tab id={value} className={cx(tabsCls.tab, className)}>{children}</Tab>;
}

type TabsPanelProps = HTMLAttributes<HTMLDivElement> & { value: string; pt?: string };
function TabsPanelComp({ value, pt, className, style, children, ...props }: TabsPanelProps) {
  return (
    <TabPanel id={value} className={cx(tabsCls.panel, className)} style={{ ...(pt ? { paddingTop: pt } : {}), ...style }} {...props}>
      {children}
    </TabPanel>
  );
}

export const Tabs = Object.assign(TabsRoot, {
  List: TabsList,
  Tab: TabsTab,
  Panel: TabsPanelComp,
});
```

---

## Task 14: Modal

**Files:** Create `src/ds/components/modal.tsx`

- [ ] **Step 1: Create `src/ds/components/modal.tsx`**

```tsx
import { type ReactNode } from 'react';
import {
  Dialog as AriaDialog,
  Heading,
  Modal as AriaModal,
  ModalOverlay,
} from 'react-aria-components';
import { styles } from 'typestyles';
import { color, font, space } from '../tokens';

const modalCls = {
  overlay: styles.class('nb-modal-overlay', {
    position: 'fixed',
    inset: '0',
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: space.md,
  }),
  modal: styles.class('nb-modal', {
    background: color.bg,
    border: `2px solid ${color.border}`,
    borderRadius: '0',
    boxShadow: `6px 6px 0 0 ${color.border}`,
    width: '100%',
    outline: 'none',
    animation: 'nb-fadein 150ms ease',
  }),
  content: styles.class('nb-modal-content', { padding: space.lg }),
  header: styles.class('nb-modal-header', {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: `${space.md} ${space.lg}`,
    borderBottom: `2px solid ${color.border}`,
  }),
  title: styles.class('nb-modal-title', { fontSize: font.sizeLg, fontWeight: font.w700 }),
  closeBtn: styles.class('nb-modal-close', {
    background: 'none',
    border: `2px solid ${color.border}`,
    padding: '2px 8px',
    cursor: 'pointer',
    fontFamily: font.familySans,
    fontSize: font.sizeLg,
    lineHeight: '1',
    '&:hover': { background: color.grayLight },
  }),
};

const SIZE_MAP: Record<string, string> = {
  xs: '360px', sm: '480px', md: '600px', lg: '800px', xl: '1000px',
};

export type ModalProps = {
  opened: boolean;
  onClose: () => void;
  title?: ReactNode;
  children?: ReactNode;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
};

export function Modal({ opened, onClose, title, children, size = 'md' }: ModalProps) {
  return (
    <ModalOverlay
      isOpen={opened}
      onOpenChange={(open) => { if (!open) onClose(); }}
      className={modalCls.overlay}
    >
      <AriaModal className={modalCls.modal} style={{ maxWidth: SIZE_MAP[size] }}>
        <AriaDialog>
          {({ close }) => (
            <>
              <div className={modalCls.header}>
                <Heading slot="title" className={modalCls.title}>{title}</Heading>
                <button className={modalCls.closeBtn} onClick={close} aria-label="Close">×</button>
              </div>
              <div className={modalCls.content}>{children}</div>
            </>
          )}
        </AriaDialog>
      </AriaModal>
    </ModalOverlay>
  );
}
```

---

## Task 15: Tooltip

**Files:** Create `src/ds/components/tooltip.tsx`

- [ ] **Step 1: Create `src/ds/components/tooltip.tsx`**

```tsx
import { type ReactNode } from 'react';
import {
  OverlayArrow,
  Tooltip as AriaTooltip,
  TooltipTrigger,
} from 'react-aria-components';
import { styles } from 'typestyles';
import { color, font, space } from '../tokens';

const tooltipCls = styles.class('nb-tooltip', {
  background: color.border,
  color: color.bg,
  fontFamily: font.familySans,
  fontSize: font.sizeXs,
  fontWeight: font.w600,
  padding: `${space.xs} ${space.sm}`,
  borderRadius: '0',
  maxWidth: '280px',
  zIndex: 1001,
  animation: 'nb-fadein 100ms ease',
});

export type TooltipProps = {
  label: ReactNode;
  children: ReactNode;
  withArrow?: boolean;
  multiline?: boolean;
};

export function Tooltip({ label, children, withArrow }: TooltipProps) {
  return (
    <TooltipTrigger delay={400}>
      {children}
      <AriaTooltip className={tooltipCls}>
        {withArrow && <OverlayArrow><svg width={8} height={8}><path d="M0 0 L4 4 L8 0" fill="black"/></svg></OverlayArrow>}
        {label}
      </AriaTooltip>
    </TooltipTrigger>
  );
}
```

---

## Task 16: AppShell + NavLink

**Files:** Create `src/ds/components/app-shell.tsx`

- [ ] **Step 1: Create `src/ds/components/app-shell.tsx`**

```tsx
import { type HTMLAttributes, type ReactNode, createContext, useContext } from 'react';
import { styles, cx } from 'typestyles';
import { color, font, space } from '../tokens';

const shellCls = {
  root: styles.class('nb-shell-root', {
    display: 'grid',
    gridTemplateRows: 'auto 1fr',
    gridTemplateColumns: '220px 1fr',
    gridTemplateAreas: '"header header" "navbar main"',
    height: '100%',
    minHeight: '100vh',
  }),
  header: styles.class('nb-shell-header', {
    gridArea: 'header',
    display: 'flex',
    alignItems: 'center',
    borderBottom: `2px solid ${color.border}`,
    background: color.bg,
    boxShadow: `0 2px 0 0 ${color.border}`,
    position: 'sticky',
    top: '0',
    zIndex: 100,
    height: '56px',
  }),
  navbar: styles.class('nb-shell-navbar', {
    gridArea: 'navbar',
    borderRight: `2px solid ${color.border}`,
    background: color.surface,
    overflowY: 'auto',
    position: 'sticky',
    top: '56px',
    height: 'calc(100vh - 56px)',
  }),
  main: styles.class('nb-shell-main', {
    gridArea: 'main',
    padding: space.md,
    overflowY: 'auto',
  }),
};

const ShellContext = createContext<{ padding: string }>({ padding: space.md });

type ShellHeaderProps = HTMLAttributes<HTMLDivElement> & { px?: string; h?: number };
function ShellHeader({ px = space.md, h, children, className, style, ...props }: ShellHeaderProps) {
  return (
    <header
      className={cx(shellCls.header, className)}
      style={{ height: h ? `${h}px` : '56px', padding: `0 ${px}`, ...style }}
      {...props}
    >
      {children}
    </header>
  );
}

type ShellNavbarProps = HTMLAttributes<HTMLElement> & { p?: string; width?: { width: number; breakpoint: string } };
function ShellNavbar({ p = space.sm, width, children, className, style, ...props }: ShellNavbarProps) {
  return (
    <nav
      className={cx(shellCls.navbar, className)}
      style={{ width: width?.width ? `${width.width}px` : '220px', padding: p, gridTemplateColumns: 'unset', ...style }}
      {...props}
    >
      {children}
    </nav>
  );
}

type ShellMainProps = HTMLAttributes<HTMLElement>;
function ShellMain({ children, className, style, ...props }: ShellMainProps) {
  return (
    <main className={cx(shellCls.main, className)} style={style} {...props}>
      {children}
    </main>
  );
}

export type AppShellProps = HTMLAttributes<HTMLDivElement> & {
  header?: { height: number };
  navbar?: { width: number; breakpoint: string };
  padding?: string;
  children: ReactNode;
};

function AppShellRoot({ header, navbar, padding = space.md, children, className, ...props }: AppShellProps) {
  return (
    <ShellContext.Provider value={{ padding }}>
      <div className={cx(shellCls.root, className)} {...props}>
        {children}
      </div>
    </ShellContext.Provider>
  );
}

export const AppShell = Object.assign(AppShellRoot, {
  Header: ShellHeader,
  Navbar: ShellNavbar,
  Main: ShellMain,
});

// ── NavLink ────────────────────────────────────────────────────────────

const navLinkCls = styles.component('nb-navlink', {
  base: {
    display: 'flex',
    alignItems: 'center',
    gap: space.sm,
    padding: `${space.xs} ${space.sm}`,
    fontFamily: font.familySans,
    fontSize: font.sizeMd,
    fontWeight: font.w500,
    color: color.text,
    textDecoration: 'none',
    border: '2px solid transparent',
    borderRadius: '0',
    cursor: 'pointer',
    background: 'transparent',
    transition: 'background 80ms',
    '&:hover': { background: color.grayLight, borderColor: color.grayBg },
  },
  variants: {
    active: {
      true: {
        background: color.border,
        color: color.bg,
        borderColor: color.border,
        fontWeight: font.w700,
        '&:hover': { background: '#222' },
      },
    },
  },
  defaultVariants: { active: 'false' },
});

export type NavLinkProps = HTMLAttributes<HTMLAnchorElement> & {
  component?: React.ElementType;
  to?: string;
  label?: ReactNode;
  leftSection?: ReactNode;
  active?: boolean;
  href?: string;
};

export function NavLink({ component: Tag = 'a', to, label, leftSection, active, className, ...props }: NavLinkProps) {
  return (
    <Tag
      to={to}
      href={to}
      className={cx(navLinkCls({ active: active ? 'true' : 'false' }), className)}
      {...props}
    >
      {leftSection}
      {label}
    </Tag>
  );
}
```

---

## Task 17: Notifications system

**Files:** Create `src/ds/notifications.tsx`

- [ ] **Step 1: Create `src/ds/notifications.tsx`**

```tsx
import { type ReactNode, createContext, useContext, useState, useCallback, useEffect } from 'react';
import { styles } from 'typestyles';
import { color, font, space } from './tokens';

type ToastLevel = 'success' | 'error' | 'info' | 'warning';

type Toast = {
  id: string;
  message: string;
  title?: string;
  color?: string;
  icon?: ReactNode;
  autoClose?: number | false;
};

type NotificationsApi = {
  show: (opts: { message: string; title?: string; color?: string; icon?: ReactNode; autoClose?: number | false }) => void;
};

let externalShow: NotificationsApi['show'] | null = null;

export const notifications: NotificationsApi = {
  show(opts) {
    externalShow?.(opts);
  },
};

let _id = 0;

const toastContainerCls = styles.class('nb-toast-container', {
  position: 'fixed',
  top: '16px',
  right: '16px',
  zIndex: 9999,
  display: 'flex',
  flexDirection: 'column',
  gap: space.sm,
  maxWidth: '380px',
});

const toastCls = styles.component('nb-toast', {
  base: {
    background: color.bg,
    border: `2px solid ${color.border}`,
    borderRadius: '0',
    boxShadow: `4px 4px 0 0 ${color.border}`,
    padding: space.md,
    fontFamily: font.familySans,
    fontSize: font.sizeSm,
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    animation: 'nb-fadein 150ms ease',
    minWidth: '280px',
  },
  variants: {
    level: {
      success: { borderLeftColor: color.green,  borderLeftWidth: '4px' },
      error:   { borderLeftColor: color.red,    borderLeftWidth: '4px' },
      warning: { borderLeftColor: color.orange, borderLeftWidth: '4px' },
      info:    { borderLeftColor: color.blue,   borderLeftWidth: '4px' },
      default: {},
    },
  },
  defaultVariants: { level: 'default' },
});

function colorToLevel(c?: string): 'success' | 'error' | 'warning' | 'info' | 'default' {
  if (c === 'green' || c === 'teal') return 'success';
  if (c === 'red') return 'error';
  if (c === 'orange' || c === 'yellow') return 'warning';
  if (c === 'blue' || c === 'cyan' || c === 'indigo' || c === 'violet') return 'info';
  return 'default';
}

export function Notifications() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback<NotificationsApi['show']>((opts) => {
    const id = String(++_id);
    const toast: Toast = { id, autoClose: 4000, ...opts };
    setToasts((prev) => [...prev, toast]);
    if (toast.autoClose !== false) {
      setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), toast.autoClose as number);
    }
  }, []);

  useEffect(() => { externalShow = show; return () => { externalShow = null; }; }, [show]);

  return (
    <div className={toastContainerCls}>
      {toasts.map((t) => (
        <div key={t.id} className={toastCls({ level: colorToLevel(t.color) })}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
            <div>
              {t.title && <div style={{ fontWeight: 700, marginBottom: '2px' }}>{t.title}</div>}
              <div>{t.message}</div>
            </div>
            <button
              onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', lineHeight: 1, padding: '0 2px', color: color.dimmed }}
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
```

---

## Task 18: Hooks

**Files:** Create `src/ds/hooks.ts`

- [ ] **Step 1: Create `src/ds/hooks.ts`**

```typescript
import { useCallback, useEffect, useRef, useState } from 'react';

export function useDebouncedValue<T>(value: T, delay: number): [T] {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return [debounced];
}

export function useDisclosure(initial = false): [boolean, { open: () => void; close: () => void; toggle: () => void }] {
  const [opened, setOpened] = useState(initial);
  const open   = useCallback(() => setOpened(true),  []);
  const close  = useCallback(() => setOpened(false), []);
  const toggle = useCallback(() => setOpened((o) => !o), []);
  return [opened, { open, close, toggle }];
}
```

---

## Task 19: Barrel export

**Files:** Create `src/ds/index.ts`

- [ ] **Step 1: Create `src/ds/index.ts`**

```typescript
export * from './tokens';
export * from './hooks';
export { notifications } from './notifications';
export { Notifications } from './notifications';
export * from './components/layout';
export * from './components/text';
export * from './components/badge';
export * from './components/loader';
export * from './components/surface';
export * from './components/code';
export * from './components/anchor';
export * from './components/button';
export * from './components/input';
export * from './components/select';
export * from './components/tabs';
export * from './components/modal';
export * from './components/tooltip';
export * from './components/progress';
export * from './components/collapse';
export * from './components/app-shell';
```

- [ ] **Step 2: Verify the app builds (type-check only)**

```bash
cd apps/runtime-ui && pnpm type-check 2>&1 | head -40
```

Expected: only errors from files still importing from `@mantine/*` (those get fixed in subsequent tasks).

---

## Task 20: Migrate App.tsx

**Files:** Modify `src/App.tsx`

- [ ] **Step 1: Replace `src/App.tsx`**

```tsx
import { Group, Text, Title, Badge } from './ds';
import { AppShell, NavLink } from './ds/components/app-shell';
import {
  IconActivity,
  IconBook,
  IconCoin,
  IconCpu,
  IconFlask,
  IconLayoutDashboard,
} from '@tabler/icons-react';
import {
  NavLink as RouterNavLink,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import { useRuntimeState } from './api/hooks';
import { BenchPage } from './pages/BenchPage';
import { BenchRunPage } from './pages/BenchRunPage';
import { DashboardPage } from './pages/DashboardPage';
import { MemoriesPage } from './pages/MemoriesPage';
import { MessageCostPage } from './pages/MessageCostPage';
import { ModelsPage } from './pages/ModelsPage';
import { UsagePage } from './pages/UsagePage';
import { WorkstreamDetailPage } from './pages/WorkstreamDetailPage';
import { WorkstreamsPage } from './pages/WorkstreamsPage';

const NAV = [
  { to: '/', label: 'Dashboard', icon: IconLayoutDashboard },
  { to: '/workstreams', label: 'Workstreams', icon: IconActivity },
  { to: '/bench', label: 'Benchmark', icon: IconFlask },
  { to: '/memories', label: 'Memories', icon: IconBook },
  { to: '/usage', label: 'Usage', icon: IconCoin },
  { to: '/models', label: 'Models', icon: IconCpu },
];

export function App() {
  const { data: state } = useRuntimeState();
  const location = useLocation();

  return (
    <AppShell header={{ height: 56 }} navbar={{ width: 220, breakpoint: 'sm' }}>
      <AppShell.Header px="16px">
        <Group justify="space-between" style={{ width: '100%' }}>
          <Title order={4}>{state?.agentName ?? 'Artificer'} Runtime</Title>
          <Group gap="xs">
            {state?.busy ? (
              <Badge color="blue" variant="dot">
                working · {state.queue.running} running / {state.queue.pending} queued
              </Badge>
            ) : (
              <Badge color="gray" variant="dot">idle</Badge>
            )}
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="8px">
        {NAV.map((item) => {
          const active =
            item.to === '/'
              ? location.pathname === '/'
              : location.pathname.startsWith(item.to);
          return (
            <NavLink
              key={item.to}
              component={RouterNavLink}
              to={item.to}
              label={item.label}
              leftSection={<item.icon size={18} />}
              active={active}
            />
          );
        })}
        <Text size="xs" c="dimmed" mt={16} style={{ paddingLeft: '8px' }}>
          {state?.workstreams.length ?? 0} workstream(s)
        </Text>
      </AppShell.Navbar>

      <AppShell.Main>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/workstreams" element={<WorkstreamsPage />} />
          <Route path="/workstreams/:id" element={<WorkstreamDetailPage />} />
          <Route path="/bench" element={<BenchPage />} />
          <Route path="/bench/:instanceId" element={<BenchRunPage />} />
          <Route path="/memories" element={<MemoriesPage />} />
          <Route path="/usage" element={<UsagePage />} />
          <Route path="/models" element={<ModelsPage />} />
          <Route path="/messages/:id/cost" element={<MessageCostPage />} />
        </Routes>
      </AppShell.Main>
    </AppShell>
  );
}
```

---

## Task 21: Migrate StatusBadge + ViewRawLink + UsageStats

**Files:** Modify `src/components/StatusBadge.tsx`, `src/components/ViewRawLink.tsx`, `src/components/UsageStats.tsx`

- [ ] **Step 1: Replace `src/components/StatusBadge.tsx`**

```tsx
import { Badge } from '../ds';
import type { RunStatus, WorkstreamStatus } from '../api/types';

type BadgeColor = 'gray' | 'blue' | 'green' | 'red' | 'orange' | 'cyan' | 'violet' | 'teal' | 'grape' | 'indigo';

const WORKSTREAM_COLORS: Record<WorkstreamStatus, BadgeColor> = {
  pending:     'gray',
  planning:    'blue',
  reviewing:   'violet',
  in_progress: 'cyan',
  blocked:     'orange',
  done:        'green',
  failed:      'red',
  cancelled:   'gray',
};

const RUN_COLORS: Record<RunStatus, BadgeColor> = {
  queued:  'gray',
  running: 'blue',
  done:    'green',
  failed:  'red',
};

export function StatusBadge({ status }: { status: WorkstreamStatus | RunStatus | string }) {
  const color =
    WORKSTREAM_COLORS[status as WorkstreamStatus] ??
    RUN_COLORS[status as RunStatus] ??
    'gray';
  return (
    <Badge color={color} variant="light">
      {status.replace(/_/g, ' ')}
    </Badge>
  );
}
```

- [ ] **Step 2: Replace `src/components/ViewRawLink.tsx`**

```tsx
import { IconExternalLink } from '@tabler/icons-react';
import { useEffect, useMemo } from 'react';
import { Anchor } from '../ds';

export function ViewRawLink({ data, filename }: { data: unknown; filename: string }) {
  const href = useMemo(() => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    return URL.createObjectURL(blob);
  }, [data]);

  useEffect(() => () => URL.revokeObjectURL(href), [href]);

  return (
    <Anchor href={href} target="_blank" rel="noopener noreferrer" download={filename} size="xs" c="dimmed">
      View raw <IconExternalLink size={12} style={{ verticalAlign: -2 }} />
    </Anchor>
  );
}
```

- [ ] **Step 3: Replace `src/components/UsageStats.tsx`**

```tsx
import { Group, Paper, Text } from '../ds';
import type { UsageSummary } from '../api/types';
import { formatCost, formatTokens } from '../format';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Paper p="sm" style={{ flex: 1, minWidth: 120 }}>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>{label}</Text>
      <Text size="lg" fw={700}>{value}</Text>
    </Paper>
  );
}

export function UsageStats({ usage }: { usage: UsageSummary }) {
  return (
    <Group gap="sm" style={{ flexWrap: 'wrap' }}>
      <Stat label="Cost"          value={formatCost(usage.costUsd)} />
      <Stat label="Calls"         value={String(usage.runs)} />
      <Stat label="Requests"      value={String(usage.requests)} />
      <Stat label="Input tokens"  value={formatTokens(usage.inputTokens)} />
      <Stat label="Output tokens" value={formatTokens(usage.outputTokens)} />
    </Group>
  );
}
```

---

## Task 22: Migrate MessageComposer

**Files:** Modify `src/components/MessageComposer.tsx`

- [ ] **Step 1: Replace `src/components/MessageComposer.tsx`**

```tsx
import { Button, Group, Textarea, Text, notifications } from '../ds';
import { IconSend } from '@tabler/icons-react';
import { useState } from 'react';
import { useSendMessage } from '../api/hooks';
import { CLOUD_MODE } from '../api/client';

export function MessageComposer() {
  const [content, setContent] = useState('');
  const send = useSendMessage();

  const submit = () => {
    const text = content.trim();
    if (!text) return;
    send.mutate(text, {
      onSuccess: () => {
        setContent('');
        notifications.show({
          message: CLOUD_MODE
            ? 'Message queued — agent will pick it up when ready'
            : 'Message sent to the agent',
          color: 'green',
        });
      },
      onError: (err) => {
        notifications.show({
          title: 'Failed to send',
          message: err instanceof Error ? err.message : 'Unknown error',
          color: 'red',
        });
      },
    });
  };

  return (
    <div>
      <Textarea
        placeholder="Message the agent… (e.g. 'Build a CLI calculator', or 'How is project X going?')"
        minRows={2}
        maxRows={6}
        value={content}
        onChange={(e) => setContent(e.currentTarget.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit();
        }}
      />
      <Group justify="space-between" mt={8}>
        <Text size="xs" c="dimmed">⌘/Ctrl + Enter to send</Text>
        <Button
          leftSection={<IconSend size={16} />}
          onPress={submit}
          isDisabled={!content.trim()}
          loading={send.isPending}
          variant="filled"
        >
          Send
        </Button>
      </Group>
    </div>
  );
}
```

---

## Task 23: Migrate BreakdownTable + RunsTable

**Files:** Modify `src/components/BreakdownTable.tsx`, `src/components/RunsTable.tsx` (if exists — it's used in WorkstreamDetailPage etc.)

- [ ] **Step 1: Replace `src/components/BreakdownTable.tsx`**

```tsx
import { Anchor, Text } from '../ds';
import { Link } from 'react-router-dom';
import type { UsageSummary } from '../api/types';
import { formatCost, formatTokens } from '../format';

export interface BreakdownTableProps {
  label: string;
  data: Record<string, UsageSummary>;
  renderKey?: (key: string) => { label: string; to?: string };
}

export function BreakdownTable({ label, data, renderKey }: BreakdownTableProps) {
  const rows = Object.entries(data).sort((a, b) => b[1].costUsd - a[1].costUsd);
  if (rows.length === 0) return <Text c="dimmed" size="sm">No data.</Text>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', border: '2px solid #000' }}>
        <thead>
          <tr style={{ background: '#000', color: '#fff' }}>
            <th style={thStyle}>{label}</th>
            <th style={thStyle}>Calls</th>
            <th style={thStyle}>In / Out tokens</th>
            <th style={thStyle}>Cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([key, usage], i) => {
            const rendered = renderKey?.(key) ?? { label: key };
            return (
              <tr key={key} style={{ background: i % 2 === 0 ? '#fff' : '#f9f8f6' }}>
                <td style={tdStyle}>
                  {rendered.to ? (
                    <Anchor component={Link} to={rendered.to} size="sm">{rendered.label}</Anchor>
                  ) : (
                    <Text size="sm">{rendered.label}</Text>
                  )}
                </td>
                <td style={tdStyle}>{usage.runs}</td>
                <td style={tdStyle}>{formatTokens(usage.inputTokens)} / {formatTokens(usage.outputTokens)}</td>
                <td style={tdStyle}>{formatCost(usage.costUsd)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const thStyle: React.CSSProperties = { padding: '8px 12px', textAlign: 'left', fontWeight: 700, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', borderRight: '1px solid #333' };
const tdStyle: React.CSSProperties = { padding: '8px 12px', borderTop: '1px solid #000', borderRight: '1px solid #e5e7eb', fontSize: '13px' };
```

---

## Task 24: Migrate CallTree

**Files:** Modify `src/components/CallTree.tsx`

- [ ] **Step 1: Replace imports and Mantine usage in `src/components/CallTree.tsx`**

Replace:
```tsx
import { Box, Code, Collapse, Group, Paper, Text, UnstyledButton } from '@mantine/core';
```
With:
```tsx
import { Box, Code, Collapse, Group, Paper, Text, UnstyledButton } from '../ds';
```

Then fix the `UnstyledButton` usage — it now uses `onPress` instead of `onClick`:
```tsx
// Change all onClick on UnstyledButton to onPress
<UnstyledButton onPress={() => setOpen((o) => !o)}>
```

---

## Task 25: Migrate BenchTrajectory

**Files:** Modify `src/components/BenchTrajectory.tsx`

- [ ] **Step 1: Replace imports in `src/components/BenchTrajectory.tsx`**

Replace:
```tsx
import {
  Badge,
  Box,
  Code,
  Collapse,
  Group,
  Paper,
  Stack,
  Text,
  UnstyledButton,
} from '@mantine/core';
```
With:
```tsx
import { Badge, Box, Code, Collapse, Group, Paper, Stack, Text, UnstyledButton } from '../ds';
```

- [ ] **Step 2: Fix UnstyledButton `onClick` → `onPress`**

All `onClick` on `UnstyledButton` become `onPress`:
```tsx
// ToolCall component
<UnstyledButton onPress={() => setOpen((o) => !o)} style={{ width: '100%' }}>

// Step component  
<UnstyledButton onPress={() => setOpen((o) => !o)} style={{ width: '100%' }}>
```

- [ ] **Step 3: Replace `variant="light"` on Badge (already compatible — no change needed)**

Badge `variant="light"` is supported by our DS. No change needed.

---

## Task 26: Migrate TokenSpendChart (fix Mantine CSS vars)

**Files:** Modify `src/components/TokenSpendChart.tsx`

- [ ] **Step 1: Replace imports**

Replace:
```tsx
import { Box, Group, Paper, Stack, Text, Tooltip } from '@mantine/core';
```
With:
```tsx
import { Box, Group, Paper, Stack, Text, Tooltip } from '../ds';
import { RAW } from '../ds/tokens';
```

- [ ] **Step 2: Replace `roleColor()` and `TOKEN_LAYERS` color references**

Replace `ROLE_COLOR` values (they currently return Mantine color names used in `var(--mantine-color-X-6)`). Update to use `RAW`:

```tsx
const ROLE_COLOR_HEX: Record<string, string> = {
  communicator: RAW.grape,
  orchestrator: RAW.indigo,
  planner:      RAW.blue,
  worker:       RAW.teal,
  reviewer:     RAW.violet,
  librarian:    RAW.orange,
};

const TOKEN_LAYERS = [
  { key: 'inputTokens'              as const, label: 'Input',       color: RAW.blue },
  { key: 'outputTokens'             as const, label: 'Output',      color: RAW.teal },
  { key: 'cacheReadInputTokens'     as const, label: 'Cache read',  color: RAW.gray },
  { key: 'cacheCreationInputTokens' as const, label: 'Cache write', color: RAW.orange },
];

function roleColor(role: string): string {
  return ROLE_COLOR_HEX[role] ?? RAW.gray;
}
```

- [ ] **Step 3: Replace `var(--mantine-color-*)` in inline styles**

Find all occurrences of `var(--mantine-color-gray-1)`, `var(--mantine-color-gray-3)`, `var(--mantine-color-X-6)` and replace:
- `var(--mantine-color-gray-1)` → `RAW.grayLight`
- `var(--mantine-color-gray-3)` → `RAW.grayBg`
- `backgroundColor: \`var(--mantine-color-${roleColor(role)}-6)\`` → `backgroundColor: roleColor(role)`
- `backgroundColor: \`var(--mantine-color-${layer.color}-6)\`` → `backgroundColor: layer.color` (now a hex string)

- [ ] **Step 4: Fix `<Box w={...}>` legend squares**

Replace `<Box w={10} h={10} style={{ borderRadius: 2, backgroundColor: ... }}>` with:
```tsx
<span style={{ display: 'inline-block', width: 10, height: 10, background: layer.color, flexShrink: 0 }} />
```

- [ ] **Step 5: Fix Tooltip usage**

The DS `Tooltip` takes `label` + `children`. Update wrapping of StackedBar:
```tsx
<Tooltip label={`${role} · ${formatTokens(tokens)} tok · ${formatCost(usage.costUsd)}`}>
  <StackedBar ... />
</Tooltip>
```

For the multiline timeline tooltip, build a simple string:
```tsx
<Tooltip
  label={`#${i + 1} · ${run.role}\n${formatTokens(tokens)} tokens${run.toolCalls.length > 0 ? `\n${run.toolCalls.length} tool calls` : ''}`}
>
  <StackedBar ... />
</Tooltip>
```

---

## Task 27: Migrate BenchEfficiencyChart (fix Mantine CSS vars)

**Files:** Modify `src/components/BenchEfficiencyChart.tsx`

- [ ] **Step 1: Replace imports**

Replace:
```tsx
import { Box, Group, Paper, Text } from '@mantine/core';
```
With:
```tsx
import { Box, Group, Paper, Text } from '../ds';
import { RAW } from '../ds/tokens';
```

- [ ] **Step 2: Replace `pointColor()` function**

```tsx
function pointColor(p: BenchEfficiencyPoint): string {
  if (p.kind === 'run')
    return p.isCurrent ? RAW.blue : RAW.gray;
  if (p.resolved === true)  return RAW.green;
  if (p.resolved === false) return RAW.red;
  return RAW.gray;
}
```

- [ ] **Step 3: Replace SVG `fill` and `stroke` color references**

- `stroke="var(--mantine-color-gray-3)"` → `stroke={RAW.grayBg}`
- `fill="var(--mantine-color-dimmed)"` → `fill={RAW.dimmed}`
- `stroke={p.isCurrent ? 'var(--mantine-color-blue-9)' : 'white'}` → `stroke={p.isCurrent ? RAW.indigo : '#fff'}`

---

## Task 28: Migrate DashboardPage

**Files:** Modify `src/pages/DashboardPage.tsx`

- [ ] **Step 1: Replace Mantine imports**

Replace:
```tsx
import { Badge, Card, Group, Loader, Paper, ScrollArea, Stack, Text, Title } from '@mantine/core';
```
With:
```tsx
import { Badge, Card, Group, Loader, Paper, ScrollArea, Stack, Text, Title } from '../ds';
```

No other changes needed — props are compatible.

---

## Task 29: Migrate WorkstreamsPage

**Files:** Modify `src/pages/WorkstreamsPage.tsx`

- [ ] **Step 1: Replace Mantine imports**

Replace:
```tsx
import { Card, Group, Loader, SimpleGrid, Stack, Text, Title } from '@mantine/core';
```
With:
```tsx
import { Card, Group, Loader, SimpleGrid, Stack, Text, Title } from '../ds';
```

- [ ] **Step 2: Fix `Card` usage**

Mantine `Card` has `component={Link}`. Our `Card` extends `Paper` which accepts `component`. Verify the `component={Link}` prop is forwarded — it is via `PaperProps.component`. No further change needed.

---

## Task 30: Migrate WorkstreamDetailPage

**Files:** Modify `src/pages/WorkstreamDetailPage.tsx`

- [ ] **Step 1: Replace Mantine imports**

Replace:
```tsx
import {
  Alert, Anchor, Badge, Box, Card, Code, Group, Loader, Paper,
  SimpleGrid, Stack, Table, Tabs, Text, Title,
} from '@mantine/core';
```
With:
```tsx
import { Alert, Anchor, Badge, Box, Card, Code, Group, Loader, Paper, SimpleGrid, Stack, Text, Title } from '../ds';
import { Tabs } from '../ds/components/tabs';
```

- [ ] **Step 2: Replace the `Table` sections**

Mantine's `<Table striped withTableBorder>` becomes a plain `<table>` with styles. Replace the tasks table:

```tsx
<div style={{ overflowX: 'auto' }}>
  <table style={{ width: '100%', borderCollapse: 'collapse', border: '2px solid #000' }}>
    <thead>
      <tr style={{ background: '#000', color: '#fff' }}>
        <th style={thStyle}>Role</th>
        <th style={thStyle}>Status</th>
        <th style={thStyle}>Description</th>
        <th style={thStyle}>Result</th>
      </tr>
    </thead>
    <tbody>
      {tasks.map((t, i) => (
        <tr key={t.id} style={{ background: i % 2 === 0 ? '#fff' : '#f9f8f6' }}>
          <td style={tdStyle}><Text size="sm" fw={600}>{t.role}</Text></td>
          <td style={tdStyle}><StatusBadge status={t.status} /></td>
          <td style={tdStyle} width={320}><Text size="sm">{t.description}</Text></td>
          <td style={tdStyle} width={320}><Text size="sm" c="dimmed" lineClamp={3}>{t.result ?? '—'}</Text></td>
        </tr>
      ))}
    </tbody>
  </table>
</div>
```

Add at the top of the component (outside JSX):
```tsx
const thStyle: React.CSSProperties = { padding: '8px 12px', textAlign: 'left', fontWeight: 700, fontSize: '11px', textTransform: 'uppercase', borderRight: '1px solid #333' };
const tdStyle: React.CSSProperties = { padding: '8px 12px', borderTop: '1px solid #000', borderRight: '1px solid #e5e7eb', fontSize: '13px' };
```

- [ ] **Step 3: Replace `<Anchor component={Link}>` back links**

Already compatible. No change needed.

---

## Task 31: Migrate BenchPage

**Files:** Modify `src/pages/BenchPage.tsx`

- [ ] **Step 1: Replace Mantine imports**

Replace:
```tsx
import {
  Alert, Badge, Card, Code, Group, Loader, Paper, Progress, SimpleGrid, Stack, Table, Text, Title,
} from '@mantine/core';
```
With:
```tsx
import { Alert, Badge, Card, Code, Group, Loader, Paper, Progress, SimpleGrid, Stack, Text, Title } from '../ds';
```

- [ ] **Step 2: Replace Table with plain `<table>`**

Replace `<Table.ScrollContainer minWidth={760}>` and `<Table striped highlightOnHover withTableBorder verticalSpacing="sm">`:

```tsx
<div style={{ overflowX: 'auto' }}>
  <table style={{ width: '100%', borderCollapse: 'collapse', border: '2px solid #000', minWidth: 760 }}>
    <thead>
      <tr style={{ background: '#000', color: '#fff' }}>
        <th style={thStyle}>Verdict</th>
        <th style={thStyle}>Instance</th>
        <th style={thStyle}>Repo</th>
        <th style={thStyle}>Outcome</th>
        <th style={{ ...thStyle, textAlign: 'right' }}>Time</th>
        <th style={{ ...thStyle, textAlign: 'right' }}>Cost</th>
        <th style={{ ...thStyle, textAlign: 'right' }}>Calls</th>
        <th style={{ ...thStyle, textAlign: 'right' }}>Out tok</th>
      </tr>
    </thead>
    <tbody>
      {instances.map((row, i) => (
        <tr key={row.instanceId} style={{ background: i % 2 === 0 ? '#fff' : '#f9f8f6' }}>
          <td style={tdStyle}><Verdict row={row} /></td>
          <td style={tdStyle}>
            <Text component={Link} to={`/bench/${encodeURIComponent(row.instanceId)}`} size="sm" fw={600} c="blue">{row.instanceId}</Text>
            {row.hasTrajectory && <Badge size="xs" color="cyan" ml={6}>trajectory</Badge>}
          </td>
          <td style={tdStyle}><Text size="sm" c="dimmed">{row.repo}</Text></td>
          <td style={tdStyle}><Text size="sm">{row.outcome.replace(/_/g, ' ')}</Text></td>
          <td style={{ ...tdStyle, textAlign: 'right' }}>{formatDuration(row.durationMs)}</td>
          <td style={{ ...tdStyle, textAlign: 'right' }}>{formatCost(row.costUsd)}</td>
          <td style={{ ...tdStyle, textAlign: 'right' }}>{row.runs}</td>
          <td style={{ ...tdStyle, textAlign: 'right' }}>{formatTokensShort(row.outputTokens)}</td>
        </tr>
      ))}
    </tbody>
  </table>
</div>
```

Add constants before the component:
```tsx
const thStyle: React.CSSProperties = { padding: '8px 12px', textAlign: 'left', fontWeight: 700, fontSize: '11px', textTransform: 'uppercase', borderRight: '1px solid #333' };
const tdStyle: React.CSSProperties = { padding: '8px 12px', borderTop: '1px solid #000', borderRight: '1px solid #e5e7eb', fontSize: '13px', verticalAlign: 'middle' };
```

---

## Task 32: Migrate BenchRunPage

**Files:** Modify `src/pages/BenchRunPage.tsx`

- [ ] **Step 1: Replace Mantine imports**

Replace:
```tsx
import {
  Alert, Anchor, Badge, Box, Code, Group, Loader, Paper, SimpleGrid, Stack, Tabs, Text, Title,
} from '@mantine/core';
```
With:
```tsx
import { Alert, Anchor, Badge, Box, Code, Group, Loader, Paper, SimpleGrid, Stack, Text, Title } from '../ds';
import { Tabs } from '../ds/components/tabs';
```

- [ ] **Step 2: Fix `PatchView` colors**

Replace:
```tsx
color = 'var(--mantine-color-green-7)';
color = 'var(--mantine-color-red-7)';
color = 'var(--mantine-color-blue-6)';
color = 'var(--mantine-color-dimmed)';
```
With:
```tsx
import { RAW } from '../ds/tokens';
// ...
color = RAW.green;
color = RAW.red;
color = RAW.blue;
color = RAW.dimmed;
```

---

## Task 33: Migrate UsagePage

**Files:** Modify `src/pages/UsagePage.tsx`

- [ ] **Step 1: Replace Mantine imports**

Replace:
```tsx
import { Loader, Stack, Text, Title } from '@mantine/core';
```
With:
```tsx
import { Loader, Stack, Text, Title } from '../ds';
```

No other changes needed.

---

## Task 34: Migrate ModelsPage

**Files:** Modify `src/pages/ModelsPage.tsx`

- [ ] **Step 1: Replace Mantine imports**

Replace:
```tsx
import {
  Badge, Button, Card, Group, Loader, Select, SimpleGrid, Stack, Table, Text, Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
```
With:
```tsx
import { Badge, Button, Card, Group, Loader, Select, SimpleGrid, Stack, Text, Title, notifications } from '../ds';
```

- [ ] **Step 2: Fix `Button` props — `onClick` → `onPress`**

Replace all `onClick={...}` on `Button` with `onPress={...}`:
```tsx
// Reset button
<Button variant="default" leftSection={<IconRefresh size={16} />} isDisabled={!tiersDirty || update.isPending} onPress={() => setDraft(data.tiers)}>Reset</Button>

// Save button
<Button leftSection={<IconDeviceFloppy size={16} />} loading={update.isPending} isDisabled={!tiersDirty} onPress={saveTiers} variant="filled">Save tiers</Button>
```

- [ ] **Step 3: Fix `PresetCard` button**

Replace `<Button onClick={onApply} ...>` with `<Button onPress={onApply} ...>`.

- [ ] **Step 4: Fix `Select` data format**

Our DS `Select` uses `{ value, label }[]` or `{ group, items }[]`. The existing code passes:
```tsx
data={optionsFor(draft[tier])}
```
where `optionsFor` returns `{ group: string; items: { value: string; label: string }[] }[]`. This is exactly the format our `Select` expects. ✓

- [ ] **Step 5: Fix `Select.onChange`**

Mantine's `onChange` receives `string | null`. Our Select's `onChange` also receives `string | null`. ✓

- [ ] **Step 6: Replace Table with plain `<table>`**

```tsx
<div style={{ overflowX: 'auto' }}>
  <table style={{ width: '100%', borderCollapse: 'collapse', border: '2px solid #000' }}>
    <thead>
      <tr style={{ background: '#000', color: '#fff' }}>
        <th style={thStyle}>Tier</th>
        <th style={thStyle}>Model</th>
        <th style={thStyle}>Input $/Mtok</th>
        <th style={thStyle}>Output $/Mtok</th>
      </tr>
    </thead>
    <tbody>
      {TIERS.map((tier, i) => {
        const selected = byId.get(draft[tier]);
        return (
          <tr key={tier} style={{ background: i % 2 === 0 ? '#fff' : '#f9f8f6' }}>
            <td style={{ ...tdStyle, minWidth: 200 }}>
              <Text fw={600} style={{ textTransform: 'capitalize' }}>{tier}</Text>
              <Text size="xs" c="dimmed">{TIER_BLURB[tier]}</Text>
              <Group gap={4} mt={6} style={{ flexWrap: 'wrap' }}>
                {rolesByTier[tier].map((role) => (
                  <Badge key={role} size="xs" variant="light">{role}</Badge>
                ))}
              </Group>
            </td>
            <td style={{ ...tdStyle, minWidth: 280 }}>
              <Select
                aria-label={`${tier} tier model`}
                data={optionsFor(draft[tier])}
                value={draft[tier]}
                onChange={(value) => value && setDraft({ ...draft, [tier]: value })}
                renderOption={({ option }) => (
                  <Group justify="space-between" style={{ width: '100%' }}>
                    <Text size="sm">{option.label}</Text>
                    <Text size="xs" c="dimmed">{priceLabel(byId.get(option.value))}</Text>
                  </Group>
                )}
              />
            </td>
            <td style={tdStyle}>{selected ? money(selected.pricing.inputPerMTok) : '—'}</td>
            <td style={tdStyle}>{selected ? money(selected.pricing.outputPerMTok) : '—'}</td>
          </tr>
        );
      })}
    </tbody>
  </table>
</div>
```

Add at top of component:
```tsx
const thStyle: React.CSSProperties = { padding: '8px 12px', textAlign: 'left', fontWeight: 700, fontSize: '11px', textTransform: 'uppercase', borderRight: '1px solid #333' };
const tdStyle: React.CSSProperties = { padding: '8px 12px', borderTop: '1px solid #000', borderRight: '1px solid #e5e7eb', fontSize: '13px', verticalAlign: 'top' };
```

- [ ] **Step 7: Fix `notifications.show` with icon**

Replace `icon: <IconCheck size={16} />` — our notifications system accepts `icon` but doesn't render it prominently. Simplify to just use `color`:
```tsx
notifications.show({ color: 'teal', title: 'Models updated', message: 'New runs will use the updated tier models.' });
notifications.show({ color: 'red',  title: 'Update failed',  message: err instanceof Error ? err.message : 'Unknown error' });
```

---

## Task 35: Migrate MemoriesPage

**Files:** Modify `src/pages/MemoriesPage.tsx`

- [ ] **Step 1: Replace Mantine imports**

Replace:
```tsx
import {
  Anchor, Badge, Card, Code, Divider, Group, Loader, Modal, ScrollArea, Stack, Text, TextInput, Title,
} from '@mantine/core';
import { useDebouncedValue, useDisclosure } from '@mantine/hooks';
```
With:
```tsx
import { Anchor, Badge, Card, Code, Divider, Group, Loader, Modal, ScrollArea, Stack, Text, Title } from '../ds';
import { TextInput } from '../ds/components/input';
import { useDebouncedValue, useDisclosure } from '../ds/hooks';
```

- [ ] **Step 2: Fix `TextInput` onChange**

Our `TextInput` calls `onChange` with a `string` value (React Aria's API), not an event. Update:
```tsx
<TextInput
  aria-label="Search memories"
  leftSection={<IconSearch size={16} />}
  placeholder="Search memories…"
  value={query}
  onChange={(value) => setQuery(value)}
/>
```

- [ ] **Step 3: Fix `Modal` title prop**

Our `Modal` `title` is `ReactNode`. The existing usage `title={<Text fw={600}>...</Text>}` is compatible. ✓

---

## Task 36: Migrate MessageCostPage

**Files:** Modify `src/pages/MessageCostPage.tsx`

- [ ] **Step 1: Replace Mantine imports**

Replace:
```tsx
import {
  Alert, Anchor, Card, Group, Loader, Stack, Text, Title,
} from '@mantine/core';
```
With:
```tsx
import { Alert, Anchor, Card, Group, Loader, Stack, Text, Title } from '../ds';
```

No other changes needed.

---

## Task 37: Final cleanup + type-check

**Files:** `apps/runtime-ui/package.json`

- [ ] **Step 1: Run type-check**

```bash
cd apps/runtime-ui && pnpm type-check 2>&1
```

Fix any remaining type errors. Common issues:
- `onClick` on `UnstyledButton` should be `onPress`
- `component=` on `Text` forwarding (ensure `Tag` ref is typed correctly)
- `Tabs.Panel` `pt="md"` — our DS accepts string for `pt`

- [ ] **Step 2: Start dev server and test the app**

```bash
pnpm dev
```

Open `http://localhost:5173`. Check:
- [ ] App shell renders (header + sidebar + main)
- [ ] Navigation links highlight active route
- [ ] Dashboard page shows messages and usage stats
- [ ] Workstreams page shows cards
- [ ] Bench page renders table + charts
- [ ] Models page: Select dropdowns work, preset cards render
- [ ] Memories page: search input works, modal opens on click
- [ ] Notifications appear when sending a message

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(runtime-ui): replace Mantine with neo-brutalist design system (React Aria + TypeStyles)"
```
