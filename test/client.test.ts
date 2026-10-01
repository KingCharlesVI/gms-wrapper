import { describe, expect, it, vi } from 'vitest';
import { GmsClient, GmsHttpError, GmsNetworkError, GmsParseError, MemoryCache } from '../src/index.js';

function mockFetch(body: unknown, status = 200) {
  return vi.fn(async (_url: string, _init?: RequestInit) =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
  );
}

describe('GmsClient', () => {
  it('builds endpoint URLs and sends the api key', async () => {
    const fetch = mockFetch([]);
    const client = new GmsClient({ apiKey: 'secret', fetch });

    await client.getSeasons();
    await client.getClubTeams(42);
    await client.getClubMatchDays(42);
    await client.getClubMatchDay(42, 7);
    await client.getTeamFixtures(99);
    await client.getCompetition(5);
    await client.getCompetitionTable(5);
    await client.getCompetitionMatchDays(5);
    await client.getCompetitionMatchDay(5, 3);
    await client.getFixture(1234);

    const urls = fetch.mock.calls.map(([url]) => url.replace('https://ehdwapi.englandhockey.co.uk/api/', ''));
    expect(urls).toEqual([
      'seasons',
      'clubs/42/teams',
      'clubs/42/matchdays',
      'clubs/42/matchdays/7',
      'teams/99/fixturesandresults',
      'competitions/5',
      'competitions/5/table',
      'competitions/5/matchdays',
      'competitions/5/matchdays/3',
      'fixtures/1234',
    ]);
    const headers = fetch.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('secret');
  });

  it('supports a proxy base URL without an api key', async () => {
    const fetch = mockFetch([]);
    const client = new GmsClient({ baseUrl: 'https://example.com/gms', headers: { Authorization: 'Bearer t' }, fetch });
    await client.getTeamFixtures('a b');
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://example.com/gms/teams/a%20b/fixturesandresults');
    const headers = init!.headers as Record<string, string>;
    expect(headers['x-api-key']).toBeUndefined();
    expect(headers.Authorization).toBe('Bearer t');
  });

  it('rejects empty path segments', async () => {
    const client = new GmsClient({ fetch: mockFetch([]) });
    await expect(client.getTeamFixtures('')).rejects.toThrow(TypeError);
  });

  it('throws GmsHttpError on non-2xx', async () => {
    const client = new GmsClient({ fetch: mockFetch('nope', 404) });
    const err = await client.getFixture(1).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GmsHttpError);
    expect((err as GmsHttpError).status).toBe(404);
    expect((err as GmsHttpError).isNotFound).toBe(true);
  });

  it('throws GmsParseError on invalid JSON', async () => {
    const client = new GmsClient({ fetch: mockFetch('<html>') });
    await expect(client.getSeasons()).rejects.toBeInstanceOf(GmsParseError);
  });

  it('throws GmsNetworkError on fetch failure and timeout', async () => {
    const failing = new GmsClient({ fetch: vi.fn(async () => Promise.reject(new Error('ECONNRESET'))) });
    await expect(failing.getSeasons()).rejects.toBeInstanceOf(GmsNetworkError);

    const hanging = new GmsClient({
      timeoutMs: 10,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))),
    });
    await expect(hanging.getSeasons()).rejects.toThrow(/Timed out after 10ms/);
  });

  it('caches responses and honours noCache', async () => {
    const fetch = mockFetch([{ id: 1, description: '2025-2026' }]);
    const client = new GmsClient({ fetch, cache: new MemoryCache() });
    await client.getSeasons();
    const second = await client.getSeasons();
    expect(second).toEqual([{ id: 1, description: '2025-2026' }]);
    expect(fetch).toHaveBeenCalledTimes(1);
    await client.getSeasons({ noCache: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('collapses concurrent identical requests', async () => {
    const fetch = mockFetch([]);
    const client = new GmsClient({ fetch });
    await Promise.all([client.getClubTeams(1), client.getClubTeams(1), client.getClubTeams(2)]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('getLeagueTable falls back to the table endpoint', async () => {
    const row = { teamId: 1, teamName: 'A', gamesPlayed: 1, gamesWon: 1, gamesDrawn: 0, gamesLost: 0, goalsFor: 2, goalsAgainst: 0, goalsDifference: 2, totalPoints: 3 };
    const fetch = vi.fn(async (url: string) =>
      new Response(JSON.stringify(url.endsWith('/table') ? [row] : { name: 'Div 1', seasonName: '2025-2026', entityUrlSlug: 'div-1', table: [] })),
    );
    const client = new GmsClient({ fetch });
    expect(await client.getLeagueTable(5)).toEqual([row]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe('MemoryCache', () => {
  it('expires entries and evicts oldest past capacity', () => {
    vi.useFakeTimers();
    const cache = new MemoryCache(2);
    cache.set('a', 1, 10);
    cache.set('b', 2, 10);
    cache.set('c', 3, 10);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
    vi.advanceTimersByTime(10_001);
    expect(cache.get('c')).toBeUndefined();
    vi.useRealTimers();
  });
});
