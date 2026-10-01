import type { GmsCache } from './cache.js';
import { GmsHttpError, GmsNetworkError, GmsParseError } from './errors.js';
import type {
  ClubMatchDays,
  Competition,
  CompetitionFixtures,
  CompetitionMatchDays,
  Fixture,
  FixtureDetail,
  Id,
  LeagueTableRow,
  Season,
  Team,
} from './types.js';

export const DEFAULT_BASE_URL = 'https://ehdwapi.englandhockey.co.uk/api/';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface GmsClientOptions {
  /**
   * API key issued by England Hockey GMS support (gms.support@englandhockey.co.uk).
   * Sent as the `x-api-key` header. May be omitted when `baseUrl` points at
   * your own proxy that adds the key server-side.
   */
  apiKey?: string;
  /** Defaults to the England Hockey data warehouse API. Point this at a proxy for browser/mobile use. */
  baseUrl?: string;
  /** Extra headers on every request, e.g. auth for your own proxy. */
  headers?: Record<string, string>;
  /** Custom fetch implementation. Defaults to `globalThis.fetch`. */
  fetch?: FetchLike;
  /** Per-request timeout in ms. Default 15000. Set 0 to disable. */
  timeoutMs?: number;
  /** Optional response cache. Use `new MemoryCache()` for a simple in-process cache. */
  cache?: GmsCache;
  /**
   * Cache lifetimes in seconds. `static` applies to data that rarely changes
   * (seasons, club team lists); `default` applies to everything else.
   */
  cacheTtl?: { default?: number; static?: number };
}

export interface RequestOptions {
  signal?: AbortSignal;
  /** Skip the cache read for this call (the fresh result is still cached). */
  noCache?: boolean;
}

type TtlClass = 'default' | 'static';

export class GmsClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly cache?: GmsCache;
  private readonly ttl: Record<TtlClass, number>;
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(options: GmsClientOptions = {}) {
    const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    this.headers = { Accept: 'application/json', ...options.headers };
    if (options.apiKey) this.headers['x-api-key'] = options.apiKey;

    if (!options.fetch && typeof globalThis.fetch !== 'function') {
      throw new Error('No fetch implementation available. Use Node 18+ or pass `fetch` in GmsClientOptions.');
    }
    // Wrapped rather than stored directly so browsers don't throw "Illegal invocation".
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.cache = options.cache;
    this.ttl = {
      default: options.cacheTtl?.default ?? 3600,
      static: options.cacheTtl?.static ?? 86_400,
    };
  }

  // ---------------------------------------------------------------------------
  // Seasons
  // ---------------------------------------------------------------------------

  /** All seasons. `GET seasons` */
  getSeasons(opts?: RequestOptions): Promise<Season[]> {
    return this.get<Season[]>(['seasons'], 'static', opts);
  }

  // ---------------------------------------------------------------------------
  // Clubs
  // ---------------------------------------------------------------------------

  /** Teams belonging to a club. `GET clubs/{clubId}/teams` */
  getClubTeams(clubId: Id, opts?: RequestOptions): Promise<Team[]> {
    return this.get<Team[]>(['clubs', clubId, 'teams'], 'static', opts);
  }

  /**
   * A club's match days for the current season. Only the next match day
   * includes its fixtures; use {@link getClubMatchDay} for the others.
   * `GET clubs/{clubId}/matchdays`
   */
  getClubMatchDays(clubId: Id, opts?: RequestOptions): Promise<ClubMatchDays> {
    return this.get<ClubMatchDays>(['clubs', clubId, 'matchdays'], 'default', opts);
  }

  /** All of a club's fixtures on one match day, grouped by competition. `GET clubs/{clubId}/matchdays/{matchDayId}` */
  getClubMatchDay(clubId: Id, matchDayId: Id, opts?: RequestOptions): Promise<CompetitionFixtures[]> {
    return this.get<CompetitionFixtures[]>(['clubs', clubId, 'matchdays', matchDayId], 'default', opts);
  }

  // ---------------------------------------------------------------------------
  // Teams
  // ---------------------------------------------------------------------------

  /**
   * A team's fixtures and results for the current season, grouped by competition.
   * `GET teams/{teamId}/fixturesandresults`
   */
  getTeamFixtures(teamId: Id, opts?: RequestOptions): Promise<CompetitionFixtures[]> {
    return this.get<CompetitionFixtures[]>(['teams', teamId, 'fixturesandresults'], 'default', opts);
  }

  // ---------------------------------------------------------------------------
  // Competitions
  // ---------------------------------------------------------------------------

  /** Competition summary, which may include the league table. `GET competitions/{competitionId}` */
  getCompetition(competitionId: Id, opts?: RequestOptions): Promise<Competition> {
    return this.get<Competition>(['competitions', competitionId], 'default', opts);
  }

  /** League table for a competition. `GET competitions/{competitionId}/table` */
  getCompetitionTable(competitionId: Id, opts?: RequestOptions): Promise<LeagueTableRow[]> {
    return this.get<LeagueTableRow[]>(['competitions', competitionId, 'table'], 'default', opts);
  }

  /**
   * Gets the league table, using the table embedded in the competition summary
   * when present and falling back to the `table` endpoint otherwise.
   */
  async getLeagueTable(competitionId: Id, opts?: RequestOptions): Promise<LeagueTableRow[]> {
    const competition = await this.getCompetition(competitionId, opts);
    if (competition.table && competition.table.length > 0) return competition.table;
    return this.getCompetitionTable(competitionId, opts);
  }

  /** A competition's match days. Only the next one includes fixtures. `GET competitions/{competitionId}/matchdays` */
  getCompetitionMatchDays(competitionId: Id, opts?: RequestOptions): Promise<CompetitionMatchDays> {
    return this.get<CompetitionMatchDays>(['competitions', competitionId, 'matchdays'], 'default', opts);
  }

  /** All fixtures in a competition on one match day. `GET competitions/{competitionId}/matchdays/{matchDayId}` */
  getCompetitionMatchDay(competitionId: Id, matchDayId: Id, opts?: RequestOptions): Promise<Fixture[]> {
    return this.get<Fixture[]>(['competitions', competitionId, 'matchdays', matchDayId], 'default', opts);
  }

  // ---------------------------------------------------------------------------
  // Fixtures
  // ---------------------------------------------------------------------------

  /** Full fixture details: scorers, cards, line-ups, officials, venue address. `GET fixtures/{fixtureId}` */
  getFixture(fixtureId: Id, opts?: RequestOptions): Promise<FixtureDetail> {
    return this.get<FixtureDetail>(['fixtures', fixtureId], 'default', opts);
  }

  // ---------------------------------------------------------------------------
  // Low-level
  // ---------------------------------------------------------------------------

  /**
   * Low-level GET for endpoints this library doesn't wrap yet.
   * `path` segments are URL-encoded and joined, e.g. `['teams', 123, 'fixturesandresults']`.
   */
  request<T = unknown>(path: Array<string | number>, opts?: RequestOptions): Promise<T> {
    return this.get<T>(path, 'default', opts);
  }

  private async get<T>(path: Array<string | number>, ttlClass: TtlClass, opts: RequestOptions = {}): Promise<T> {
    if (path.some((segment) => segment === '' || segment === null || segment === undefined)) {
      throw new TypeError(`Invalid GMS API path: ${JSON.stringify(path)}`);
    }
    const url = this.baseUrl + path.map((segment) => encodeURIComponent(String(segment))).join('/');

    if (this.cache && !opts.noCache) {
      const cached = await this.cache.get(url);
      if (cached !== undefined) return cached as T;
    }

    // Collapse concurrent identical requests (only when no per-call abort signal is involved).
    if (!opts.signal) {
      const pending = this.inFlight.get(url);
      if (pending) return pending as Promise<T>;
    }

    const promise = this.fetchJson(url, opts.signal).then(async (data) => {
      if (this.cache) await this.cache.set(url, data, this.ttl[ttlClass]);
      return data as T;
    });

    if (!opts.signal) {
      this.inFlight.set(url, promise);
      promise.then(
        () => this.inFlight.delete(url),
        () => this.inFlight.delete(url),
      );
    }
    return promise;
  }

  private async fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal?.reason);
    if (signal) {
      if (signal.aborted) controller.abort(signal.reason);
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    const timer = this.timeoutMs > 0 ? setTimeout(() => controller.abort(new Error(`Timed out after ${this.timeoutMs}ms`)), this.timeoutMs) : undefined;

    let response: Response;
    let text: string;
    try {
      response = await this.fetchImpl(url, { method: 'GET', headers: this.headers, signal: controller.signal });
      text = await response.text();
    } catch (err) {
      throw new GmsNetworkError(url, controller.signal.reason ?? err);
    } finally {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }

    if (!response.ok) throw new GmsHttpError(response.status, url, text);
    if (text.trim() === '') return null;
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new GmsParseError(url, err);
    }
  }
}
