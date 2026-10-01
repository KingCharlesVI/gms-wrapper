# england-hockey-gms

A typed, zero-dependency client for the [England Hockey](https://www.englandhockey.co.uk/) **GMS (Game Management System)** data API: fixtures, results, league tables, match days and match details.

- Works anywhere with `fetch`: Node 18+, browsers, React Native / Expo, Cloudflare Workers, Deno, Bun
- Ships as ESM and CommonJS, with TypeScript types
- Optional response caching, timeouts, abort signals, and de-duplication of concurrent requests
- Helpers for common UI needs: upcoming vs results, W/D/L, form tables, goal scorers, player consent

> **Unofficial.** This package isn't affiliated with England Hockey. The API has no public schema; the endpoints and types come from England Hockey's own [Hockey GMS Feed](https://wordpress.org/plugins/eh-gms-feed/) WordPress plugin.

**📖 Full documentation: [DOCUMENTATION.md](DOCUMENTATION.md)**

## Getting access

You need permission from England Hockey to use GMS data, and an API key. Contact **gms.support@englandhockey.co.uk**.

## Install

```sh
npm install england-hockey-gms
```

## Quick start

```ts
import { GmsClient, MemoryCache, flattenFixtures, splitFixtures } from 'england-hockey-gms';

const gms = new GmsClient({
  apiKey: process.env.GMS_API_KEY,
  cache: new MemoryCache(), // optional
});

const groups = await gms.getTeamFixtures(12345);
const { upcoming, results } = splitFixtures(flattenFixtures(groups));
```

## Keep your API key off the client

**Don't ship the API key in a website bundle or a mobile app.** Anyone can extract it from there. Instead, run the client on your server and expose your own endpoints, or put a thin proxy in front of the API that adds the key. Point the client at the proxy with `baseUrl`:

```ts
// In the browser / mobile app: no key, talks to your proxy
const gms = new GmsClient({
  baseUrl: 'https://api.yourclub.co.uk/gms/',
  headers: { Authorization: `Bearer ${userToken}` }, // optional, for your own auth
});
```

Here is a minimal proxy, e.g. a Next.js route handler at `app/api/gms/[...path]/route.ts`:

```ts
export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const res = await fetch(`https://ehdwapi.englandhockey.co.uk/api/${path.map(encodeURIComponent).join('/')}`, {
    headers: { 'x-api-key': process.env.GMS_API_KEY! },
    next: { revalidate: 3600 },
  });
  return new Response(res.body, { status: res.status, headers: { 'content-type': 'application/json' } });
}
```

A proxy also lets you cache centrally, and it avoids any CORS restrictions on the upstream API.

## API

### `new GmsClient(options?)`

| Option | Default | |
| --- | --- | --- |
| `apiKey` | none | Sent as `x-api-key`. Omit when using a proxy. |
| `baseUrl` | `https://ehdwapi.englandhockey.co.uk/api/` | |
| `headers` | `{}` | Extra headers on every request. |
| `fetch` | `globalThis.fetch` | Custom fetch implementation. |
| `timeoutMs` | `15000` | `0` disables. |
| `cache` | none | Any `{ get, set }` store. See [Caching](#caching). |
| `cacheTtl` | `{ default: 3600, static: 86400 }` | Seconds. `static` covers seasons and club team lists. |

### Endpoints

Every method takes an optional final `{ signal?: AbortSignal, noCache?: boolean }`.

| Method | Endpoint | Returns |
| --- | --- | --- |
| `getSeasons()` | `seasons` | `Season[]` |
| `getClubTeams(clubId)` | `clubs/{id}/teams` | `Team[]` |
| `getClubMatchDays(clubId)` | `clubs/{id}/matchdays` | `ClubMatchDays` |
| `getClubMatchDay(clubId, matchDayId)` | `clubs/{id}/matchdays/{mdId}` | `CompetitionFixtures[]` |
| `getTeamFixtures(teamId)` | `teams/{id}/fixturesandresults` | `CompetitionFixtures[]` |
| `getCompetition(competitionId)` | `competitions/{id}` | `Competition` |
| `getCompetitionTable(competitionId)` | `competitions/{id}/table` | `LeagueTableRow[]` |
| `getLeagueTable(competitionId)` | summary, then `table` | `LeagueTableRow[]` |
| `getCompetitionMatchDays(competitionId)` | `competitions/{id}/matchdays` | `CompetitionMatchDays` |
| `getCompetitionMatchDay(competitionId, matchDayId)` | `competitions/{id}/matchdays/{mdId}` | `Fixture[]` |
| `getFixture(fixtureId)` | `fixtures/{id}` | `FixtureDetail` |
| `request(pathSegments)` | anything else | `unknown` |

Match-day lists only include fixtures for the **next** match day. Fetch other days individually:

```ts
const { matchDays, nextMatchDay } = await gms.getClubMatchDays(clubId);
const saturday = await gms.getClubMatchDay(clubId, matchDays[3].id);
```

IDs are found in GMS, or in the URLs and embed codes on englandhockey.co.uk.

### Helpers

```ts
import {
  getFixtureState,   // 'upcoming' | 'result' | 'awaiting-result' | 'postponed' | 'cancelled' | 'bye'
  getScore,          // { home, away, shootout? } | null
  getOutcome,        // 'W' | 'D' | 'L' | null, for { teamId } or { clubId }
  getSide,           // 'home' | 'away' | null
  fixtureDay,        // 'YYYY-MM-DD'
  fixtureTime,       // 'HH:mm' | null ("00:00" in GMS means not set)
  flattenFixtures,   // CompetitionFixtures[] -> date-sorted fixtures tagged with competition
  splitFixtures,     // -> { upcoming, results }
  summariseTeam,     // P/W/D/L/GF/GA/GD/points/PPG/form/next fixture across all competitions
  rankTeams,         // sort summaries by PPG, GD, GF, wins
  getGoalScorers,    // group FG/PC/PS events by player
  getVisiblePlayers, // respects GMS consent: { players, withheld }
  playerRole,        // 'GK' | 'C' | null
  formatVenueAddress,
  englandHockeyUrl,  // .club(slug) .team(slug) .competition(slug) .googleMaps(query)
} from 'england-hockey-gms';
```

Example: a club "form table" covering all its teams:

```ts
const teams = await gms.getClubTeams(clubId);
const summaries = await Promise.all(
  teams.map(async (t) => summariseTeam(t.id, await gms.getTeamFixtures(t.id))),
);
const table = rankTeams(summaries);
```

**Player data:** GMS records whether each player has consented to public display. `getVisiblePlayers` applies the same rule England Hockey's own plugin uses. Respect it in your UI.

### Errors

All errors extend `GmsError`:

- `GmsHttpError`: non-2xx response (`.status`, `.url`, `.body`, `.isNotFound`)
- `GmsNetworkError`: network failure, timeout or abort
- `GmsParseError`: invalid JSON

```ts
try {
  await gms.getFixture(id);
} catch (err) {
  if (err instanceof GmsHttpError && err.isNotFound) return notFound();
  throw err;
}
```

### Caching

`MemoryCache` is an in-process TTL cache. To use a shared or persistent store, implement `GmsCache`:

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { GmsCache } from 'england-hockey-gms';

const asyncStorageCache: GmsCache = {
  async get(key) {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return undefined;
    const { value, expires } = JSON.parse(raw);
    return Date.now() < expires ? value : undefined;
  },
  async set(key, value, ttl) {
    await AsyncStorage.setItem(key, JSON.stringify({ value, expires: Date.now() + ttl * 1000 }));
  },
};
```

## Using it from another project before publishing

```sh
# in this repo
npm run build && npm link
# in your app
npm link england-hockey-gms
```

Or install straight from GitHub (the `prepare` script builds it on install):

```sh
npm install github:KingCharlesVI/gms-wrapper
```

## Development

```sh
npm install
npm test          # vitest
npm run typecheck
npm run build     # tsup -> dist/ (ESM + CJS + .d.ts)
npm publish       # runs typecheck, tests and build first
```

## License

MIT
