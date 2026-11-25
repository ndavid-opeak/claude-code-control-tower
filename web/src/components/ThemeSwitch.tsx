import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export type Theme = "system" | "light" | "dark";
const KEY = "theme";
const OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "Match system", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

function stored(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

/** The chosen theme, applied as <html data-theme>; "system" removes it so prefers-color-scheme decides. */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(stored);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") delete root.dataset.theme;
    else root.dataset.theme = theme;
    try {
      if (theme === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, theme);
    } catch {}
  }, [theme]);
  return [theme, setTheme];
}

export function ThemeSwitch({ theme, onChange, className }: { theme: Theme; onChange: (t: Theme) => void; className?: string }) {
  return (
    <div className={cn("inline-flex rounded-lg border p-0.5", className)} role="radiogroup" aria-label="Theme">
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          title={label}
          aria-label={label}
          onClick={() => onChange(value)}
          className={cn(
            "grid size-7 place-items-center rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring",
            theme === value ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}
