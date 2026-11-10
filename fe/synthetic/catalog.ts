// A closed catalog, never populated from browsing history or arbitrary DOM text.
export const FIXTURE_ORIGIN = 'http://127.0.0.1:8911';
export const catalog: Record<string, string> = Object.fromEntries(['a', 'b', 'c', 'd'].map(id => [id,
  `Synthetic fixture ${id}. This public example describes TypeScript transactions and durable page observations. No participant information is present.`]));
export function fixtureId(raw: string): string | undefined {
  try {
    const u = new URL(raw), id = u.pathname.split('/').at(-1)!;
    return u.origin === FIXTURE_ORIGIN && u.pathname === `/__focus_synthetic__/${id}` && catalog[id] ? id : undefined;
  } catch { return; }
}
