// ─── Chorus Theme System ─────────────────────────────────

export interface SearchDecorations {
  matchBackground: string;
  matchBorder: string;
  matchOverviewRuler: string;
  activeMatchBackground: string;
  activeMatchBorder: string;
  activeMatchColorOverviewRuler: string;
}

export interface XtermColors {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  selectionForeground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface ThemeDefinition {
  id: string;
  name: string;
  preview: { bg: string; panel: string; accent: string };
  cssVars: Record<string, string>;
  xtermTheme: XtermColors;
  searchDecorations: SearchDecorations;
}

// ─── Espresso — warm dark brown with amber accent ────────

const espresso: ThemeDefinition = {
  id: 'espresso',
  name: 'Espresso',
  preview: { bg: '#15120a', panel: '#1f1910', accent: '#D4A06A' },
  cssVars: {
    'bg-terminal': '#15120a',
    'bg-panel': '#1f1910',
    'bg-surface': '#282014',
    'bg-elevated': '#302618',
    'bg-status-bar': '#1f1910',
    'bg-hover': '#2d2314',
    'bg-active': '#382c1c',

    'text-primary': '#efe8d8',
    'text-secondary': '#a69880',
    'text-dimmed': '#706048',
    'text-accent': '#D4A06A',

    'accent-primary': '#D4A06A',
    'accent-blue': '#D4A06A',
    'accent-info': '#7da8d8',
    'accent-orange': '#D4A06A',
    'accent-green': '#5ec9a0',
    'accent-yellow': '#fbbf24',
    'accent-red': '#ef4444',

    'border-subtle': 'rgba(212, 190, 160, 0.06)',
    'border-default': 'rgba(212, 190, 160, 0.10)',
    'border-active': '#D4A06A',

    'status-idle': '#5ec9a0',
    'status-thinking': '#fbbf24',
    'status-generating': '#7da8d8',
    'status-creating': '#a78bfa',
    'status-error': '#ef4444',
    'status-ended': '#706048',

    'shadow-sm': '0 1px 2px rgba(10, 6, 0, 0.3)',
    'shadow-md': '0 4px 16px rgba(10, 6, 0, 0.4)',
    'shadow-lg': '0 12px 40px rgba(10, 6, 0, 0.55)',

    'tint-rgb': '212, 190, 160',
    'shade-rgb': '10, 6, 0',
    'accent-rgb': '212, 160, 106',
    'btn-primary-text': '#1a1408',
  },
  xtermTheme: {
    background: '#15120a',
    foreground: '#e0d9c6',
    cursor: '#D4A06A',
    cursorAccent: '#15120a',
    selectionBackground: 'rgba(212, 160, 106, 0.26)',
    selectionForeground: '#fff8ee',
    black: '#1f1910',
    red: '#f07068',
    green: '#5ec9a0',
    yellow: '#f0b840',
    blue: '#7da8d8',
    magenta: '#c49ae0',
    cyan: '#4ebdbd',
    white: '#e0d9c6',
    brightBlack: '#706048',
    brightRed: '#f8a8a0',
    brightGreen: '#88d8b4',
    brightYellow: '#f5d07a',
    brightBlue: '#a0c4e8',
    brightMagenta: '#d8b4f0',
    brightCyan: '#7dd4cc',
    brightWhite: '#f5eede',
  },
  searchDecorations: {
    matchBackground: '#4d3c28',
    matchBorder: 'transparent',
    matchOverviewRuler: '#8b7355',
    activeMatchBackground: '#6b5233',
    activeMatchBorder: '#D4A06A',
    activeMatchColorOverviewRuler: '#D4A06A',
  },
};

// ─── Obsidian — cool neutral dark with violet accent ─────

const obsidian: ThemeDefinition = {
  id: 'obsidian',
  name: 'Obsidian',
  preview: { bg: '#111318', panel: '#181a22', accent: '#a78bfa' },
  cssVars: {
    'bg-terminal': '#111318',
    'bg-panel': '#181a22',
    'bg-surface': '#1e2028',
    'bg-elevated': '#262830',
    'bg-status-bar': '#181a22',
    'bg-hover': '#222430',
    'bg-active': '#2c2e3a',

    'text-primary': '#e8e6f0',
    'text-secondary': '#8a8ea0',
    'text-dimmed': '#555868',
    'text-accent': '#a78bfa',

    'accent-primary': '#a78bfa',
    'accent-blue': '#a78bfa',
    'accent-info': '#7da8d8',
    'accent-orange': '#f0a050',
    'accent-green': '#5ec9a0',
    'accent-yellow': '#fbbf24',
    'accent-red': '#ef4444',

    'border-subtle': 'rgba(150, 155, 200, 0.06)',
    'border-default': 'rgba(150, 155, 200, 0.10)',
    'border-active': '#a78bfa',

    'status-idle': '#5ec9a0',
    'status-thinking': '#fbbf24',
    'status-generating': '#7da8d8',
    'status-creating': '#a78bfa',
    'status-error': '#ef4444',
    'status-ended': '#555868',

    'shadow-sm': '0 1px 2px rgba(5, 5, 12, 0.3)',
    'shadow-md': '0 4px 16px rgba(5, 5, 12, 0.4)',
    'shadow-lg': '0 12px 40px rgba(5, 5, 12, 0.55)',

    'tint-rgb': '150, 155, 200',
    'shade-rgb': '5, 5, 12',
    'accent-rgb': '167, 139, 250',
    'btn-primary-text': '#14121e',
  },
  xtermTheme: {
    background: '#111318',
    foreground: '#d8d6e0',
    cursor: '#a78bfa',
    cursorAccent: '#111318',
    selectionBackground: 'rgba(167, 139, 250, 0.24)',
    selectionForeground: '#f4f0ff',
    black: '#181a22',
    red: '#f07068',
    green: '#5ec9a0',
    yellow: '#e8b840',
    blue: '#6898d8',
    magenta: '#c49ae0',
    cyan: '#4ebdbd',
    white: '#d8d6e0',
    brightBlack: '#555868',
    brightRed: '#f8a8a0',
    brightGreen: '#88d8b4',
    brightYellow: '#f0d070',
    brightBlue: '#98b8e8',
    brightMagenta: '#d8b4f0',
    brightCyan: '#78d0d0',
    brightWhite: '#f0eef8',
  },
  searchDecorations: {
    matchBackground: '#2e2848',
    matchBorder: 'transparent',
    matchOverviewRuler: '#7060a0',
    activeMatchBackground: '#3d3560',
    activeMatchBorder: '#a78bfa',
    activeMatchColorOverviewRuler: '#a78bfa',
  },
};

// ─── Midnight — deep navy with cyan accent ───────────────

const midnight: ThemeDefinition = {
  id: 'midnight',
  name: 'Midnight',
  preview: { bg: '#0b0f1a', panel: '#111828', accent: '#22d3ee' },
  cssVars: {
    'bg-terminal': '#0b0f1a',
    'bg-panel': '#111828',
    'bg-surface': '#182030',
    'bg-elevated': '#1e2838',
    'bg-status-bar': '#111828',
    'bg-hover': '#1a2438',
    'bg-active': '#223048',

    'text-primary': '#dce8f5',
    'text-secondary': '#7898b8',
    'text-dimmed': '#4a6480',
    'text-accent': '#22d3ee',

    'accent-primary': '#22d3ee',
    'accent-blue': '#22d3ee',
    'accent-info': '#22d3ee',
    'accent-orange': '#f0a050',
    'accent-green': '#34d399',
    'accent-yellow': '#fbbf24',
    'accent-red': '#f87171',

    'border-subtle': 'rgba(100, 160, 220, 0.06)',
    'border-default': 'rgba(100, 160, 220, 0.10)',
    'border-active': '#22d3ee',

    'status-idle': '#34d399',
    'status-thinking': '#fbbf24',
    'status-generating': '#22d3ee',
    'status-creating': '#a78bfa',
    'status-error': '#f87171',
    'status-ended': '#4a6480',

    'shadow-sm': '0 1px 2px rgba(2, 4, 12, 0.3)',
    'shadow-md': '0 4px 16px rgba(2, 4, 12, 0.4)',
    'shadow-lg': '0 12px 40px rgba(2, 4, 12, 0.55)',

    'tint-rgb': '100, 160, 220',
    'shade-rgb': '2, 4, 12',
    'accent-rgb': '34, 211, 238',
    'btn-primary-text': '#081018',
  },
  xtermTheme: {
    background: '#0b0f1a',
    foreground: '#c8d8e8',
    cursor: '#22d3ee',
    cursorAccent: '#0b0f1a',
    selectionBackground: 'rgba(34, 211, 238, 0.22)',
    selectionForeground: '#f0f8ff',
    black: '#111828',
    red: '#f87171',
    green: '#34d399',
    yellow: '#fbbf24',
    blue: '#60a5fa',
    magenta: '#c084fc',
    cyan: '#22d3ee',
    white: '#c8d8e8',
    brightBlack: '#4a6480',
    brightRed: '#fca5a5',
    brightGreen: '#6ee7b7',
    brightYellow: '#fcd34d',
    brightBlue: '#93c5fd',
    brightMagenta: '#d8b4fe',
    brightCyan: '#67e8f9',
    brightWhite: '#e8f0f8',
  },
  searchDecorations: {
    matchBackground: '#1a3050',
    matchBorder: 'transparent',
    matchOverviewRuler: '#2288aa',
    activeMatchBackground: '#204060',
    activeMatchBorder: '#22d3ee',
    activeMatchColorOverviewRuler: '#22d3ee',
  },
};

// ─── Forest — dark green with emerald accent ─────────────

const forest: ThemeDefinition = {
  id: 'forest',
  name: 'Forest',
  preview: { bg: '#0c120f', panel: '#131e18', accent: '#34d399' },
  cssVars: {
    'bg-terminal': '#0c120f',
    'bg-panel': '#131e18',
    'bg-surface': '#1a2820',
    'bg-elevated': '#223028',
    'bg-status-bar': '#131e18',
    'bg-hover': '#1c2c22',
    'bg-active': '#263830',

    'text-primary': '#dceee4',
    'text-secondary': '#80a890',
    'text-dimmed': '#507058',
    'text-accent': '#34d399',

    'accent-primary': '#34d399',
    'accent-blue': '#34d399',
    'accent-info': '#60b0d0',
    'accent-orange': '#e8a848',
    'accent-green': '#34d399',
    'accent-yellow': '#e8c840',
    'accent-red': '#ef4444',

    'border-subtle': 'rgba(130, 200, 160, 0.06)',
    'border-default': 'rgba(130, 200, 160, 0.10)',
    'border-active': '#34d399',

    'status-idle': '#34d399',
    'status-thinking': '#e8c840',
    'status-generating': '#60b0d0',
    'status-creating': '#a78bfa',
    'status-error': '#ef4444',
    'status-ended': '#507058',

    'shadow-sm': '0 1px 2px rgba(4, 8, 5, 0.3)',
    'shadow-md': '0 4px 16px rgba(4, 8, 5, 0.4)',
    'shadow-lg': '0 12px 40px rgba(4, 8, 5, 0.55)',

    'tint-rgb': '130, 200, 160',
    'shade-rgb': '4, 8, 5',
    'accent-rgb': '52, 211, 153',
    'btn-primary-text': '#0a1810',
  },
  xtermTheme: {
    background: '#0c120f',
    foreground: '#c8dcd0',
    cursor: '#34d399',
    cursorAccent: '#0c120f',
    selectionBackground: 'rgba(52, 211, 153, 0.22)',
    selectionForeground: '#f0fff6',
    black: '#131e18',
    red: '#e87070',
    green: '#34d399',
    yellow: '#e8c840',
    blue: '#60a8d0',
    magenta: '#b880d8',
    cyan: '#48c8b0',
    white: '#c8dcd0',
    brightBlack: '#507058',
    brightRed: '#f0a0a0',
    brightGreen: '#6ee7b7',
    brightYellow: '#f0d870',
    brightBlue: '#90c0e0',
    brightMagenta: '#c8a0e8',
    brightCyan: '#78d8c8',
    brightWhite: '#e8f4ee',
  },
  searchDecorations: {
    matchBackground: '#1a3828',
    matchBorder: 'transparent',
    matchOverviewRuler: '#2a8860',
    activeMatchBackground: '#224838',
    activeMatchBorder: '#34d399',
    activeMatchColorOverviewRuler: '#34d399',
  },
};

// ─── Arctic — light theme with indigo accent ─────────────

const arctic: ThemeDefinition = {
  id: 'arctic',
  name: 'Arctic',
  preview: { bg: '#f7f8fb', panel: '#eef0f5', accent: '#5046e5' },
  cssVars: {
    'bg-terminal': '#f7f8fb',
    'bg-panel': '#eef0f5',
    'bg-surface': '#e5e8f0',
    'bg-elevated': '#ffffff',
    'bg-status-bar': '#eef0f5',
    'bg-hover': '#dde1ec',
    'bg-active': '#d0d5e4',

    'text-primary': '#1e2234',
    'text-secondary': '#5c6478',
    'text-dimmed': '#8c94a8',
    'text-accent': '#5046e5',

    'accent-primary': '#5046e5',
    'accent-blue': '#5046e5',
    'accent-info': '#3b82f6',
    'accent-orange': '#d97706',
    'accent-green': '#059669',
    'accent-yellow': '#ca8a04',
    'accent-red': '#dc2626',

    'border-subtle': 'rgba(30, 34, 52, 0.06)',
    'border-default': 'rgba(30, 34, 52, 0.12)',
    'border-active': '#5046e5',

    'status-idle': '#059669',
    'status-thinking': '#ca8a04',
    'status-generating': '#3b82f6',
    'status-creating': '#7c3aed',
    'status-error': '#dc2626',
    'status-ended': '#8c94a8',

    'shadow-sm': '0 1px 2px rgba(20, 25, 45, 0.06)',
    'shadow-md': '0 4px 16px rgba(20, 25, 45, 0.08)',
    'shadow-lg': '0 12px 40px rgba(20, 25, 45, 0.12)',

    'tint-rgb': '30, 34, 52',
    'shade-rgb': '20, 25, 45',
    'accent-rgb': '80, 70, 229',
    'btn-primary-text': '#ffffff',
  },
  xtermTheme: {
    background: '#f7f8fb',
    foreground: '#2a3040',
    cursor: '#5046e5',
    cursorAccent: '#f7f8fb',
    selectionBackground: 'rgba(80, 70, 229, 0.15)',
    selectionForeground: '#1e2234',
    black: '#3a4058',
    red: '#dc2626',
    green: '#059669',
    yellow: '#ca8a04',
    blue: '#2563eb',
    magenta: '#7c3aed',
    cyan: '#0891b2',
    white: '#5c6478',
    brightBlack: '#8c94a8',
    brightRed: '#ef4444',
    brightGreen: '#10b981',
    brightYellow: '#eab308',
    brightBlue: '#3b82f6',
    brightMagenta: '#8b5cf6',
    brightCyan: '#06b6d4',
    brightWhite: '#1e2234',
  },
  searchDecorations: {
    matchBackground: '#c8c4f0',
    matchBorder: 'transparent',
    matchOverviewRuler: '#7068d0',
    activeMatchBackground: '#a8a0e8',
    activeMatchBorder: '#5046e5',
    activeMatchColorOverviewRuler: '#5046e5',
  },
};

// ─── Latte — warm cream light with golden brown accent ───

const latte: ThemeDefinition = {
  id: 'latte',
  name: 'Latte',
  preview: { bg: '#faf6f0', panel: '#f0ebe2', accent: '#8b6914' },
  cssVars: {
    'bg-terminal': '#faf6f0',
    'bg-panel': '#f0ebe2',
    'bg-surface': '#e6dfd4',
    'bg-elevated': '#fffdf8',
    'bg-status-bar': '#f0ebe2',
    'bg-hover': '#e0d8cc',
    'bg-active': '#d6ccbe',

    'text-primary': '#2c2418',
    'text-secondary': '#6b5e4c',
    'text-dimmed': '#9c9080',
    'text-accent': '#8b6914',

    'accent-primary': '#8b6914',
    'accent-blue': '#8b6914',
    'accent-info': '#3060a0',
    'accent-orange': '#a06800',
    'accent-green': '#2d7a4f',
    'accent-yellow': '#9a7000',
    'accent-red': '#c53030',

    'border-subtle': 'rgba(60, 48, 30, 0.06)',
    'border-default': 'rgba(60, 48, 30, 0.12)',
    'border-active': '#8b6914',

    'status-idle': '#2d7a4f',
    'status-thinking': '#9a7000',
    'status-generating': '#3060a0',
    'status-creating': '#7040a0',
    'status-error': '#c53030',
    'status-ended': '#9c9080',

    'shadow-sm': '0 1px 2px rgba(40, 30, 15, 0.06)',
    'shadow-md': '0 4px 16px rgba(40, 30, 15, 0.08)',
    'shadow-lg': '0 12px 40px rgba(40, 30, 15, 0.12)',

    'tint-rgb': '60, 48, 30',
    'shade-rgb': '40, 30, 15',
    'accent-rgb': '139, 105, 20',
    'btn-primary-text': '#ffffff',
  },
  xtermTheme: {
    background: '#faf6f0',
    foreground: '#3a3024',
    cursor: '#8b6914',
    cursorAccent: '#faf6f0',
    selectionBackground: 'rgba(139, 105, 20, 0.15)',
    selectionForeground: '#2c2418',
    black: '#4a4030',
    red: '#c53030',
    green: '#2d7a4f',
    yellow: '#9a7000',
    blue: '#3060a0',
    magenta: '#8040a0',
    cyan: '#1a7880',
    white: '#6b5e4c',
    brightBlack: '#9c9080',
    brightRed: '#e04040',
    brightGreen: '#38946a',
    brightYellow: '#b08800',
    brightBlue: '#4078c0',
    brightMagenta: '#9858b8',
    brightCyan: '#2a9098',
    brightWhite: '#2c2418',
  },
  searchDecorations: {
    matchBackground: '#e8dcc0',
    matchBorder: 'transparent',
    matchOverviewRuler: '#b09040',
    activeMatchBackground: '#d8c8a0',
    activeMatchBorder: '#8b6914',
    activeMatchColorOverviewRuler: '#8b6914',
  },
};

// ─── Sakura — soft rose light with coral accent ──────────

const sakura: ThemeDefinition = {
  id: 'sakura',
  name: 'Sakura',
  preview: { bg: '#fdf7f8', panel: '#f5eced', accent: '#d4487a' },
  cssVars: {
    'bg-terminal': '#fdf7f8',
    'bg-panel': '#f5eced',
    'bg-surface': '#ebe2e4',
    'bg-elevated': '#ffffff',
    'bg-status-bar': '#f5eced',
    'bg-hover': '#e8dde0',
    'bg-active': '#ddd0d4',

    'text-primary': '#2d2028',
    'text-secondary': '#6e5a62',
    'text-dimmed': '#a0909a',
    'text-accent': '#d4487a',

    'accent-primary': '#d4487a',
    'accent-blue': '#d4487a',
    'accent-info': '#3868b0',
    'accent-orange': '#c07020',
    'accent-green': '#1a8860',
    'accent-yellow': '#b07800',
    'accent-red': '#c82050',

    'border-subtle': 'rgba(50, 30, 40, 0.06)',
    'border-default': 'rgba(50, 30, 40, 0.12)',
    'border-active': '#d4487a',

    'status-idle': '#1a8860',
    'status-thinking': '#b07800',
    'status-generating': '#3868b0',
    'status-creating': '#9040a0',
    'status-error': '#c82050',
    'status-ended': '#a0909a',

    'shadow-sm': '0 1px 2px rgba(35, 20, 28, 0.06)',
    'shadow-md': '0 4px 16px rgba(35, 20, 28, 0.08)',
    'shadow-lg': '0 12px 40px rgba(35, 20, 28, 0.12)',

    'tint-rgb': '50, 30, 40',
    'shade-rgb': '35, 20, 28',
    'accent-rgb': '212, 72, 122',
    'btn-primary-text': '#ffffff',
  },
  xtermTheme: {
    background: '#fdf7f8',
    foreground: '#3a2830',
    cursor: '#d4487a',
    cursorAccent: '#fdf7f8',
    selectionBackground: 'rgba(212, 72, 122, 0.14)',
    selectionForeground: '#2d2028',
    black: '#4a3840',
    red: '#c82050',
    green: '#1a8860',
    yellow: '#b07800',
    blue: '#3868b0',
    magenta: '#9040a0',
    cyan: '#1a7880',
    white: '#6e5a62',
    brightBlack: '#a0909a',
    brightRed: '#e03868',
    brightGreen: '#30a878',
    brightYellow: '#c89000',
    brightBlue: '#5080c8',
    brightMagenta: '#a858b8',
    brightCyan: '#309098',
    brightWhite: '#2d2028',
  },
  searchDecorations: {
    matchBackground: '#f0d0dc',
    matchBorder: 'transparent',
    matchOverviewRuler: '#d06090',
    activeMatchBackground: '#e8b8c8',
    activeMatchBorder: '#d4487a',
    activeMatchColorOverviewRuler: '#d4487a',
  },
};

// ─── Meadow — light mint with teal accent ────────────────

const meadow: ThemeDefinition = {
  id: 'meadow',
  name: 'Meadow',
  preview: { bg: '#f5faf7', panel: '#ebf3ee', accent: '#0d7377' },
  cssVars: {
    'bg-terminal': '#f5faf7',
    'bg-panel': '#ebf3ee',
    'bg-surface': '#e0eae4',
    'bg-elevated': '#fafffc',
    'bg-status-bar': '#ebf3ee',
    'bg-hover': '#d8e6dc',
    'bg-active': '#ccddd2',

    'text-primary': '#1a2c22',
    'text-secondary': '#4a6455',
    'text-dimmed': '#82a090',
    'text-accent': '#0d7377',

    'accent-primary': '#0d7377',
    'accent-blue': '#0d7377',
    'accent-info': '#306898',
    'accent-orange': '#906800',
    'accent-green': '#0d7050',
    'accent-yellow': '#8a7000',
    'accent-red': '#c53030',

    'border-subtle': 'rgba(25, 48, 35, 0.06)',
    'border-default': 'rgba(25, 48, 35, 0.12)',
    'border-active': '#0d7377',

    'status-idle': '#0d7050',
    'status-thinking': '#8a7000',
    'status-generating': '#306898',
    'status-creating': '#7040a0',
    'status-error': '#c53030',
    'status-ended': '#82a090',

    'shadow-sm': '0 1px 2px rgba(15, 30, 22, 0.06)',
    'shadow-md': '0 4px 16px rgba(15, 30, 22, 0.08)',
    'shadow-lg': '0 12px 40px rgba(15, 30, 22, 0.12)',

    'tint-rgb': '25, 48, 35',
    'shade-rgb': '15, 30, 22',
    'accent-rgb': '13, 115, 119',
    'btn-primary-text': '#ffffff',
  },
  xtermTheme: {
    background: '#f5faf7',
    foreground: '#283830',
    cursor: '#0d7377',
    cursorAccent: '#f5faf7',
    selectionBackground: 'rgba(13, 115, 119, 0.14)',
    selectionForeground: '#1a2c22',
    black: '#384840',
    red: '#c53030',
    green: '#0d7050',
    yellow: '#8a7000',
    blue: '#306898',
    magenta: '#7040a0',
    cyan: '#0d7377',
    white: '#4a6455',
    brightBlack: '#82a090',
    brightRed: '#e04040',
    brightGreen: '#189868',
    brightYellow: '#a88800',
    brightBlue: '#4880b0',
    brightMagenta: '#8858b8',
    brightCyan: '#1a9098',
    brightWhite: '#1a2c22',
  },
  searchDecorations: {
    matchBackground: '#c0e8d8',
    matchBorder: 'transparent',
    matchOverviewRuler: '#30a0a0',
    activeMatchBackground: '#a8d8c8',
    activeMatchBorder: '#0d7377',
    activeMatchColorOverviewRuler: '#0d7377',
  },
};

// ─── Exports ─────────────────────────────────────────────

export const THEMES: ThemeDefinition[] = [espresso, obsidian, midnight, forest, arctic, latte, sakura, meadow];

export const DEFAULT_THEME_ID = 'espresso';

export function getTheme(id: string): ThemeDefinition {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

export function applyThemeCss(id: string): void {
  const theme = getTheme(id);
  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme.cssVars)) {
    root.style.setProperty(`--${key}`, value);
  }
}
