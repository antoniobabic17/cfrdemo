import { createContext, useContext, useEffect, useState } from 'react';
import { Monitor, Sun, Moon } from 'lucide-react';
import { Button } from '../components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';

// ─── Types ────────────────────────────────────────────────────────────────────

export type Theme = 'system' | 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedTheme: 'light' | 'dark';
}

// ─── Context ──────────────────────────────────────────────────────────────────

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'system',
  setTheme: () => {},
  resolvedTheme: 'dark',
});

const STORAGE_KEY = 'cfr-pmo-theme';

function getStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    // localStorage may be unavailable in Power Apps sandbox
  }
  return 'system';
}

function saveTheme(theme: Theme) {
  try {
    if (theme === 'system') {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, theme);
    }
  } catch {
    // ignore
  }
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme);

  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  );

  // Track live system preference changes (only affects UI when theme === 'system')
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    function handler(e: MediaQueryListEvent) {
      setSystemDark(e.matches);
    }
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const resolvedTheme: 'light' | 'dark' =
    theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  // Apply class to <html> so CSS custom property overrides take effect
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(resolvedTheme);
  }, [resolvedTheme]);

  function setTheme(t: Theme) {
    setThemeState(t);
    saveTheme(t);
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolvedTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useTheme() {
  return useContext(ThemeContext);
}

// ─── ThemeToggle UI ───────────────────────────────────────────────────────────

const THEME_OPTIONS: { value: Theme; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { value: 'system', label: 'System', Icon: Monitor },
  { value: 'light',  label: 'Light',  Icon: Sun },
  { value: 'dark',   label: 'Dark',   Icon: Moon },
];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  const active = THEME_OPTIONS.find((o) => o.value === theme) ?? THEME_OPTIONS[0];
  const ActiveIcon = active.Icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground hover:bg-accent"
          title={`Theme: ${active.label}`}
          aria-label="Toggle theme"
        >
          <ActiveIcon className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[120px]">
        {THEME_OPTIONS.map(({ value, label, Icon }) => (
          <DropdownMenuItem
            key={value}
            onClick={() => setTheme(value)}
            className={theme === value ? 'text-primary font-medium' : ''}
          >
            <Icon className="h-3.5 w-3.5 mr-2 shrink-0" />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
