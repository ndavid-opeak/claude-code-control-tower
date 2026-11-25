import { FAMILIES, type Config, type Family } from "./api.ts";

/** Who answers first for this family right now, from the mode, the route and the enabled providers. */
export function primaryOf(config: Config, family: Family): string {
  if (config.mode === "anthropic") return "anthropic";
  for (const entry of config.routes[family] ?? []) {
    const p = config.providers.find((x) => x.id === entry.split("/")[0]);
    if (p && p.enabled !== false) return p.id;
  }
  return "anthropic";
}

/** The provider every family starts with, or null when families start with different providers. */
export function defaultProviderOf(config: Config): string | null {
  const ids = new Set(FAMILIES.map((f) => primaryOf(config, f)));
  return ids.size === 1 ? [...ids][0] : null;
}

/** Families whose chain has no target on this Gemini provider, so a model must be picked for them. */
export function familiesMissing(config: Config, providerId: string): Family[] {
  const p = config.providers.find((x) => x.id === providerId);
  if (p?.type !== "gemini") return [];
  return FAMILIES.filter((f) => !config.routes[f].some((t) => t.startsWith(`${providerId}/`)));
}

/**
 * Config patch that makes a provider answer first for every family.
 * Anthropic: pass-through mode. Gemini: routing mode, the provider enabled, and its targets moved to the
 * top of each chain (the rest stay as fallbacks); `models` supplies a target for families that have none.
 */
export function makeDefault(config: Config, providerId: string, models: Partial<Record<Family, string>> = {}): Partial<Config> {
  const p = config.providers.find((x) => x.id === providerId);
  if (!p) throw new Error(`Unknown provider ${providerId}`);
  if (p.type === "anthropic") return { mode: "anthropic" };

  const routes = {} as Record<Family, string[]>;
  for (const f of FAMILIES) {
    const chain = config.routes[f];
    const own = chain.filter((t) => t.startsWith(`${providerId}/`));
    if (!own.length) {
      const model = models[f]?.trim();
      if (!model) throw new Error(`Pick a ${f} model for ${p.name || p.id}`);
      own.push(`${providerId}/${model}`);
    }
    routes[f] = [...own, ...chain.filter((t) => !own.includes(t))];
  }
  return {
    mode: "route",
    routes,
    providers: config.providers.map((x) => (x.id === providerId ? { ...x, enabled: true } : x)),
  };
}
