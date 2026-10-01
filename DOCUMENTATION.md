# england-hockey-gms: Documentation

A complete guide to `england-hockey-gms`, a typed, zero-dependency JavaScript/TypeScript client for the England Hockey **GMS (Game Management System)** data API.

> **Unofficial.** This package isn't affiliated with or endorsed by England Hockey. The API has no public schema. The endpoints and response types here come from England Hockey's own [Hockey GMS Feed](https://wordpress.org/plugins/eh-gms-feed/) WordPress plugin, and **haven't yet been checked against live responses**. See [Limitations and known unknowns](#limitations-and-known-unknowns).

---

## Contents

1. [Overview](#overview)
2. [Requirements](#requirements)
3. [Getting API access](#getting-api-access)
4. [Installation](#installation)
5. [Architecture: keep the key on a server](#architecture-keep-the-key-on-a-server)
6. [Quick start](#quick-start)
7. [Core concepts](#core-concepts)
8. [Client reference](#client-reference)
9. [Helper reference](#helper-reference)
10. [Type reference](#type-reference)
11. [Errors](#errors)
12. [Caching](#caching)
13. [Cancellation and timeouts](#cancellation-and-timeouts)
14. [Proxy setups](#proxy-setups)
15. [Recipes](#recipes)
16. [Framework integration](#framework-integration)
17. [Displaying data responsibly](#displaying-data-responsibly)
18. [Testing your code](#testing-your-code)
19. [Troubleshooting](#troubleshooting)
20. [Limitations and known unknowns](#limitations-and-known-unknowns)
21. [Contributing and releasing](#contributing-and-releasing)

---

## Overview

GMS is England Hockey's system for recording every club match in England: teams, fixtures, results, league tables, line-ups, scorers, cards and officials. From the 2022–23 season, the data is available from a read-only HTTP API backed by England Hockey's Azure data warehouse.

This package gives you:

| Feature | Details |
| --- | --- |
| **Typed client** | One method per endpoint, with TypeScript types for every response |
| **Runs anywhere** | Uses the built-in `fetch`: Node 18+, browsers, React Native / Expo, Deno, Bun, Cloudflare Workers, Vercel Edge |
| **Zero dependencies** | Nothing extra in your bundle |
| **ESM + CommonJS** | Works with `import` and `require` |
| **Caching** | Optional, pluggable, with per-endpoint lifetimes |
| **Resilience** | Timeouts, `AbortSignal` support, de-duplication of identical concurrent requests |
| **Typed errors** | Separate error classes for HTTP errors, network failures and bad JSON |
| **Helpers** | Upcoming vs results, W/D/L, scores, form tables, goal scorers, player consent, links |

---

## Requirements

- **Node.js 18 or later** (for global `fetch` and `AbortController`), or any runtime that provides `fetch`
- An England Hockey GMS **API key**, used on your server only
- TypeScript is optional; types are included if you use it (TypeScript 5+ recommended)

---

## Getting API access

England Hockey requires permission to use GMS data on your website or app.

1. Email **gms.support@englandhockey.co.uk**.
2. Explain what you're building (e.g. "club website and mobile app for X Hockey Club") and which data you need (fixtures, results, league tables, match details).
3. Ask for an **API key**. Also ask for your **club ID**, and the team and competition IDs if you need them (see [Finding IDs](#finding-ids)).

The key is sent as an HTTP header, `x-api-key`. Treat it like a password.

---

## Installation

```sh
npm install england-hockey-gms
# or
yarn add england-hockey-gms
# or
pnpm add england-hockey-gms
```

ES modules:

```ts
import { GmsClient } from 'england-hockey-gms';
```

CommonJS:

```js
const { GmsClient } = require('england-hockey-gms');
```

---

## Architecture: keep the key on a server

**Never put your API key in browser JavaScript or in a mobile app build.** Anyone can extract it from there, and misuse would be traced to your key.

The recommended setup:

```
┌────────────────┐      ┌───────────────────────────┐      ┌──────────────────────┐
│ Website        │      │ Your server               │      │ England Hockey       │
│ Mobile app     │ ───▶ │ - holds GMS_API_KEY       │ ───▶ │ ehdwapi.englandhockey│
│ (no key)       │      │ - caches responses        │      │ .co.uk/api/          │
└────────────────┘      │ - allowlists endpoints    │      └──────────────────────┘
                        └───────────────────────────┘
```

There are two ways to build the middle box:

| Approach | How | Good for |
| --- | --- | --- |
| **A. Your own API** | Use `GmsClient` on the server and expose your own endpoints shaped for your UI, e.g. `/api/teams/123/summary` | Most projects. Smaller payloads, full control, can combine calls |
| **B. Pass-through proxy** | Forward `/api/gms/*` to England Hockey, adding the key. Clients use `GmsClient` with `baseUrl` pointed at the proxy | Getting started quickly, or when clients need the raw data |

You can mix both. Either way, the same package runs on the server and on clients. See [Proxy setups](#proxy-setups) for complete code.

---

## Quick start

### On a server (with the key)

```ts
import { GmsClient, MemoryCache, flattenFixtures, splitFixtures, fixtureDay, fixtureTime, getScore } from 'england-hockey-gms';

const gms = new GmsClient({
  apiKey: process.env.GMS_API_KEY,
  cache: new MemoryCache(),
});

const TEAM_ID = 12345;

const groups = await gms.getTeamFixtures(TEAM_ID);
const { upcoming, results } = splitFixtures(flattenFixtures(groups));

for (const f of upcoming) {
  console.log(`${fixtureDay(f)} ${fixtureTime(f) ?? 'TBC'}  ${f.homeTeam.teamName} v ${f.awayTeam.teamName}  @ ${f.venue ?? 'TBC'}`);
}

for (const f of results) {
  const score = getScore(f);
  console.log(`${fixtureDay(f)}  ${f.homeTeam.teamName} ${score ? `${score.home}-${score.away}` : f.status} ${f.awayTeam.teamName}`);
}
```

### In a browser or app (through your proxy, without the key)

```ts
import { GmsClient } from 'england-hockey-gms';

const gms = new GmsClient({ baseUrl: 'https://yourclub.co.uk/api/gms/' });
const table = await gms.getLeagueTable(678);
```

---

## Core concepts

### The data model

```
Season
Club ──┬── Team ── (plays in) ── Competition ── League table
       │                              │
       └── Match days                 └── Match days
                │                              │
                └──────── Fixture ◀────────────┘
                             │
                             └── Fixture detail: events, players, officials, venue
```

- **Club**: e.g. "Anytown HC". Has many teams.
- **Team**: e.g. "Anytown HC Men's 1s". Has a gender, and belongs to one club.
- **Competition**: a league division or cup in a season. Leagues have a table.
- **Fixture**: one match between a home team and an away team. When it has been played, it's a "result".
- **Match day**: a date on which a club (or competition) has fixtures.
- **Season**: e.g. "2025-2026".

### IDs

Every entity has an ID. In this package the `Id` type is `number | string`, because the API's ID format isn't confirmed. All methods accept either, and helpers compare IDs as strings, so `123` and `"123"` match.

### Finding IDs

You need at least one starting ID:

- **Club ID**: ask GMS support. It may also be visible to club administrators in GMS.
- **Team IDs**: call `getClubTeams(clubId)`; each team has an `id`.
- **Competition IDs**: present on each group returned by `getTeamFixtures(teamId)` (`competitionId`).
- **Fixture IDs**: present on every fixture (`id`).
- **Match day IDs**: returned by `getClubMatchDays` / `getCompetitionMatchDays`.

The englandhockey.co.uk website uses **slugs** in its URLs, not numeric IDs. Slugs are returned by the API (`entityUrlSlug`, `clubUrlSlug`, …) so you can link to the website, but you can't use them to call the API.

A practical approach: find your club ID once, call `getClubTeams`, and store the team IDs you care about in your app's config or database.

### Dates and times

- `fixtureDate` is an ISO-style string such as `"2025-10-11T00:00:00"`. Only the date part is meaningful. Use `fixtureDay(f)` to get `"2025-10-11"`.
- `fixtureTime` is `"HH:mm"`. GMS uses `"00:00"` to mean "time not set". Use `fixtureTime(f)`, which returns `null` in that case.
- Both are **UK local time** and have no time zone.
- Helpers that need "today" (`getFixtureState`, `splitFixtures`, `summariseTeam`) use the **runtime's local date**. On a server running in UTC this can be an hour out around midnight during British Summer Time. If that matters, run your server in `Europe/London` (e.g. `TZ=Europe/London`) or pass a `now` value.

### Scores and statuses

- Scores are usually numeric strings (`"3"`), with numeric copies in `homeTeamScoreAsInt` / `awayTeamScoreAsInt`.
- A score of **`"P"`** on both sides means **postponed**; **`"C"`** means **cancelled**. The `status` field may also say `"Postponed"` / `"Cancelled"`.
- `isResult` is `true` once a result (including P/C) is recorded.
- `isBye` marks bye "fixtures" that aren't real matches.
- Shootout scores are in `homeTeamShootoutScore` / `awayTeamShootoutScore` (both `0` when there was no shootout).

Use `getFixtureState` and `getScore` instead of reading these fields directly. They handle all of the above.

### Match-day lists are partial

`getClubMatchDays` and `getCompetitionMatchDays` return **every** match day in the season, but only the **next** match day includes its fixtures. To show other days, call `getClubMatchDay(clubId, matchDayId)` or `getCompetitionMatchDay(competitionId, matchDayId)`.

---

## Client reference

### `new GmsClient(options?)`

```ts
import { GmsClient, MemoryCache } from 'england-hockey-gms';

const gms = new GmsClient({
  apiKey: process.env.GMS_API_KEY,
  baseUrl: 'https://ehdwapi.englandhockey.co.uk/api/',
  headers: {},
  fetch: globalThis.fetch,
  timeoutMs: 15000,
  cache: new MemoryCache(),
  cacheTtl: { default: 3600, static: 86400 },
});
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `apiKey` | `string` | none | Sent as the `x-api-key` header. Omit on clients that call your proxy. |
| `baseUrl` | `string` | `DEFAULT_BASE_URL` (`https://ehdwapi.englandhockey.co.uk/api/`) | API root. A trailing slash is added if missing. |
| `headers` | `Record<string, string>` | `{}` | Extra headers on every request, e.g. `Authorization` for your proxy. `Accept: application/json` is always sent. |
| `fetch` | `(url, init) => Promise<Response>` | `globalThis.fetch` | Custom fetch, e.g. for testing, instrumentation or older runtimes. |
| `timeoutMs` | `number` | `15000` | Abort requests after this many ms. `0` disables the timeout. |
| `cache` | `GmsCache` | none | Response cache. See [Caching](#caching). No caching if omitted. |
| `cacheTtl.default` | `number` (seconds) | `3600` | Lifetime for most responses. |
| `cacheTtl.static` | `number` (seconds) | `86400` | Lifetime for rarely-changing data: `getSeasons`, `getClubTeams`. |

The constructor throws an `Error` if no `fetch` is available and none was passed.

Create **one client per process** (or per configuration) and reuse it. The cache and request de-duplication live on the instance.

### Per-request options

Every method accepts an optional last argument:

```ts
interface RequestOptions {
  signal?: AbortSignal; // cancel the request
  noCache?: boolean;    // skip the cache read; the fresh response is still cached
}
```

```ts
const controller = new AbortController();
await gms.getTeamFixtures(123, { signal: controller.signal, noCache: true });
```

### Seasons

#### `getSeasons(opts?): Promise<Season[]>`

`GET seasons`. Lists all seasons. Cached with the `static` lifetime.

```ts
const seasons = await gms.getSeasons();
// [{ id: 5, description: '2025-2026' }, ...]
const seasonName = (id: Id) => seasons.find((s) => String(s.id) === String(id))?.description;
```

Use it to turn a competition's `seasonId` into a readable name.

### Clubs

#### `getClubTeams(clubId, opts?): Promise<Team[]>`

`GET clubs/{clubId}/teams`. All teams in a club. Cached with the `static` lifetime.

```ts
const teams = await gms.getClubTeams(CLUB_ID);
const mens = teams.filter((t) => t.gender === 'M');
```

#### `getClubMatchDays(clubId, opts?): Promise<ClubMatchDays>`

`GET clubs/{clubId}/matchdays`. All of the club's match days this season. Only the next match day includes `competitions` with fixtures.

```ts
const { nextMatchDay, matchDays } = await gms.getClubMatchDays(CLUB_ID);
const next = matchDays.find((d) => d.matchDay === nextMatchDay);
const fixtures = next?.competitions ? flattenFixtures(next.competitions) : [];
```

#### `getClubMatchDay(clubId, matchDayId, opts?): Promise<CompetitionFixtures[]>`

`GET clubs/{clubId}/matchdays/{matchDayId}`. Every fixture involving the club on one match day, grouped by competition.

```ts
const day = await gms.getClubMatchDay(CLUB_ID, matchDays[0].id);
const fixtures = flattenFixtures(day);
```

### Teams

#### `getTeamFixtures(teamId, opts?): Promise<CompetitionFixtures[]>`

`GET teams/{teamId}/fixturesandresults`. All of a team's fixtures and results for the current season, grouped by competition (league, cup, …). It may return an empty array.

```ts
const groups = await gms.getTeamFixtures(TEAM_ID);
const all = flattenFixtures(groups);            // one sorted list
const { upcoming, results } = splitFixtures(all);
const summary = summariseTeam(TEAM_ID, groups); // P/W/D/L, form, next fixture
```

### Competitions

#### `getCompetition(competitionId, opts?): Promise<Competition>`

`GET competitions/{competitionId}`. Competition summary: name, season name, website slug and, for leagues, usually the `table`.

#### `getCompetitionTable(competitionId, opts?): Promise<LeagueTableRow[]>`

`GET competitions/{competitionId}/table`. The league table on its own. Rows are in league position order.

#### `getLeagueTable(competitionId, opts?): Promise<LeagueTableRow[]>`

A convenience method: it calls `getCompetition` and returns its embedded `table` if it isn't empty; otherwise it calls `getCompetitionTable`. This mirrors what England Hockey's plugin does. **Use this one** unless you need the summary fields too.

```ts
const table = await gms.getLeagueTable(COMP_ID);
table.forEach((row, i) => console.log(i + 1, row.teamName, row.totalPoints));
```

#### `getCompetitionMatchDays(competitionId, opts?): Promise<CompetitionMatchDays>`

`GET competitions/{competitionId}/matchdays`. All match days in the competition. Only the next one includes `fixtures`.

#### `getCompetitionMatchDay(competitionId, matchDayId, opts?): Promise<Fixture[]>`

`GET competitions/{competitionId}/matchdays/{matchDayId}`. Every fixture in the competition on that day.

### Fixtures

#### `getFixture(fixtureId, opts?): Promise<FixtureDetail>`

`GET fixtures/{fixtureId}`. Everything about one match: score, venue address, goal and card events, line-ups with shirt numbers, team officials and match officials.

```ts
const match = await gms.getFixture(FIXTURE_ID);
const homeScorers = getGoalScorers(match.homeTeamEvents);
const { players, withheld } = getVisiblePlayers(match.homePlayers);
```

### Low-level

#### `request<T = unknown>(path, opts?): Promise<T>`

GETs any path under `baseUrl`, for endpoints this package doesn't wrap. `path` is an array of segments. Each segment is URL-encoded, and empty segments throw a `TypeError`. Uses the `default` cache lifetime.

```ts
const data = await gms.request<MyType>(['competitions', 678, 'something-new']);
```

### `DEFAULT_BASE_URL`

The exported constant `'https://ehdwapi.englandhockey.co.uk/api/'`.

### Request behaviour summary

For each call, the client:

1. Builds the URL from `baseUrl` + encoded path segments.
2. Returns the cached value if there is one (unless `noCache`).
3. Returns the in-flight promise if an identical request is already running (only when no `signal` is passed).
4. Sends `GET` with `Accept: application/json`, your `headers`, and `x-api-key` if `apiKey` is set.
5. Aborts after `timeoutMs`, or when your `signal` fires.
6. Throws `GmsHttpError` for non-2xx responses.
7. Returns `null` for an empty body, otherwise parses JSON (throwing `GmsParseError` if that fails).
8. Stores the result in the cache, if one is configured.

---

## Helper reference

All helpers are pure functions. They don't make requests, and they work on data from the client or from your own API.

### Dates and times

#### `fixtureDay(fixture): string`

The fixture date as `"YYYY-MM-DD"`.

#### `fixtureTime(fixture): string | null`

The start time as `"HH:mm"`, or `null` if not set (`"00:00"` in GMS).

```ts
`${fixtureDay(f)} ${fixtureTime(f) ?? 'TBC'}`
```

#### `compareFixtures(a, b): number`

Sort comparator: by date, then by time. `fixtures.sort(compareFixtures)` sorts oldest first.

### State and scores

#### `isPostponed(fixture): boolean` / `isCancelled(fixture): boolean`

True if `status` says so, or both scores are `"P"` / `"C"`.

#### `getFixtureState(fixture, now?): FixtureState`

| Returned value | Meaning |
| --- | --- |
| `'bye'` | `isBye` is true |
| `'postponed'` | Postponed |
| `'cancelled'` | Cancelled |
| `'result'` | Played, and a result was recorded |
| `'awaiting-result'` | The date has passed but no result has been entered yet |
| `'upcoming'` | Today or later, not yet played |

The checks run in that order. `now` defaults to `new Date()`.

#### `getScore(fixture): { home, away, shootout? } | null`

Numeric score, or `null` if there's no result, it's a bye, or the match was postponed/cancelled. `shootout` is present only if either shootout score is above 0.

```ts
const s = getScore(f);
const text = s ? `${s.home}-${s.away}${s.shootout ? ` (${s.shootout.home}-${s.shootout.away} SO)` : ''}` : 'v';
```

#### `getSide(fixture, { teamId?, clubId? }): 'home' | 'away' | null`

Which side a team (or any team from a club) is on. It matches by `teamId` first, then `clubId`. If both teams are from the club (an internal match), it returns `'home'`.

#### `getOutcome(fixture, { teamId?, clubId? }): 'W' | 'D' | 'L' | null`

The result from that team's or club's perspective. Shootouts are ignored, so a drawn match decided on a shootout is a `'D'`. Returns `null` if there's no score or the team isn't in the fixture.

### Lists

#### `flattenFixtures(groups): FlatFixture[]`

Turns `CompetitionFixtures[]` (from `getTeamFixtures` or `getClubMatchDay`) into one list sorted by date and time. Every fixture gets `competitionId` and `competitionName`, taken from its group if missing.

#### `splitFixtures(fixtures, now?): { upcoming, results }`

- Drops byes.
- `upcoming`: future fixtures, plus postponed/cancelled fixtures whose original date hasn't passed yet (so you can show "Postponed" on the upcoming list). Sorted oldest first.
- `results`: played fixtures, past postponed/cancelled fixtures, and past fixtures still awaiting a result. Sorted newest first.

Generic over the input type, so passing `FlatFixture[]` returns `FlatFixture[]`.

### Team summaries

#### `summariseTeam(teamId, groups, now?): TeamSummary`

Aggregates a team's record across **all** its competitions:

```ts
interface TeamSummary {
  teamId: Id;
  teamName: string | null;   // from the first fixture found
  gamesPlayed: number;
  gamesWon: number;
  gamesDrawn: number;
  gamesLost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalsDifference: number;
  totalPoints: number;       // 3 for a win, 1 for a draw
  pointsPerGame: number;     // rounded to 2 decimal places
  form: ('W' | 'D' | 'L')[]; // oldest first; use form.slice(-5) for the last five
  nextFixture: FlatFixture | null;
}
```

Byes, postponed and cancelled matches, and matches awaiting a result are excluded from the counts. **Points use a fixed 3/1/0 scheme** and may differ from an official league table, which can include deductions or different rules. For official standings, use `getLeagueTable`.

#### `rankTeams(teams): T[]`

Returns a new array sorted by points per game, then goal difference, then goals for, then wins. Points per game makes teams that have played different numbers of games comparable, which is useful for a club-wide form table.

### Match details

#### `getGoalScorers(events): GoalScorer[]`

Groups goal events (`FG` field goal, `PC` penalty corner, `PS` penalty stroke) by player. Cards are ignored.

```ts
interface GoalScorer {
  memberId?: Id;
  name: string;
  goals: { minute: number | string | null; type: string }[];
}
// e.g. "J Smith (12' FG, 40' PC)"
const text = getGoalScorers(match.homeTeamEvents)
  .map((s) => `${s.name} (${s.goals.map((g) => `${g.minute ? `${g.minute}' ` : ''}${g.type}`).join(', ')})`)
  .join(', ');
```

#### `getVisiblePlayers(players): { players, withheld }`

Applies GMS's privacy rule: a player is shown if they have **consented**, or have a **shirt number**. Others are counted in `withheld`; show them as "Name withheld". See [Displaying data responsibly](#displaying-data-responsibly).

#### `playerRole(player): 'GK' | 'C' | null`

Normalises `otherRoleDescription` (`Goalkeeper`/`GK` → `'GK'`, `Captain`/`CAPT` → `'C'`).

#### `formatVenueAddress(fixture): string | null`

Builds an address line from `venueDetails.address` and `postCode`, falling back to `venue`. It also fixes the missing spaces after commas that sometimes appear in GMS addresses.

### Links

#### `englandHockeyUrl`

```ts
englandHockeyUrl.club(team.clubUrlSlug)                // https://www.englandhockey.co.uk/clubs/{slug}
englandHockeyUrl.team(team.entityUrlSlug)              // https://www.englandhockey.co.uk/teams/{slug}
englandHockeyUrl.competition(f.competitionEntityUrlSlug!) // .../competitions/{slug}
englandHockeyUrl.googleMaps(formatVenueAddress(match)!)   // Google Maps search link
```

---

## Type reference

All types are exported. Import them with `import type { Fixture, Team } from 'england-hockey-gms'`.

Fields marked `?` may be absent. String unions such as `Gender` also accept any other string, so you'll still get autocomplete for the known values.

### Primitives

```ts
type Id = number | string;
type Gender = 'M' | 'F' | string;
type FixtureStatus = 'Active' | 'Result' | 'Bye' | 'Postponed' | 'Cancelled' | string;
type EventType = 'FG' | 'PC' | 'PS' | 'GC' | 'YC' | 'RC' | string;
type FixtureState = 'bye' | 'postponed' | 'cancelled' | 'result' | 'awaiting-result' | 'upcoming';
type Outcome = 'W' | 'D' | 'L';
```

| `EventType` | Meaning |
| --- | --- |
| `FG` | Field goal |
| `PC` | Penalty corner goal |
| `PS` | Penalty stroke goal |
| `GC` | Green card |
| `YC` | Yellow card |
| `RC` | Red card |

### `Season`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `Id` | |
| `description` | `string` | e.g. `"2025-2026"` |

### `Team`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `Id` | Team ID |
| `teamName` | `string` | |
| `gender` | `Gender` | |
| `clubId` | `Id` | |
| `clubName` | `string` | |
| `entityUrlSlug` | `string` | For `englandHockeyUrl.team` |
| `clubUrlSlug` | `string` | For `englandHockeyUrl.club` |
| `clubLogoUrl?` | `string \| null` | Image URL; may fail to load, so handle `onerror` |

### `FixtureTeam`

A team as embedded in a fixture: `id`, `teamName`, `gender`, `clubId?`, `entityUrlSlug?`, `clubUrlSlug?`, `clubLogoUrl?`.

### `Fixture`

| Field | Type | Notes |
| --- | --- | --- |
| `id` | `Id` | Use with `getFixture` |
| `fixtureDate` | `string` | ISO date; use `fixtureDay()` |
| `fixtureTime` | `string` | `"HH:mm"`, `"00:00"` = not set; use `fixtureTime()` |
| `homeTeamId?` / `awayTeamId?` | `Id` | |
| `homeTeam` / `awayTeam` | `FixtureTeam` | |
| `homeTeamScore` / `awayTeamScore` | `string \| number \| null` | `"P"` postponed, `"C"` cancelled |
| `homeTeamScoreAsInt?` / `awayTeamScoreAsInt?` | `number \| null` | |
| `homeTeamShootoutScore?` / `awayTeamShootoutScore?` | `number \| null` | `0` if no shootout |
| `isResult` | `boolean` | |
| `isBye` | `boolean` | |
| `status` | `FixtureStatus` | |
| `venue?` | `string \| null` | Venue name |
| `competitionId?` | `Id` | |
| `competitionName?` | `string` | |
| `competitionEntityUrlSlug?` | `string` | |

### `FlatFixture`

`Fixture` with `competitionId: Id` and `competitionName: string` guaranteed. Returned by `flattenFixtures`.

### `FixtureDetail` (extends `Fixture`)

| Field | Type |
| --- | --- |
| `venueDetails?` | `{ address?: string \| null; postCode?: string \| null } \| null` |
| `homeTeamEvents` / `awayTeamEvents` | `MatchEvent[]` |
| `homePlayers` / `awayPlayers` | `Player[]` |
| `homeTeamOfficials` / `awayTeamOfficials` | `Official[]` (coaches, managers) |
| `officials` | `Official[]` (umpires, technical officials) |

### `MatchEvent`

`eventType: EventType`, `minute?: number | string | null`, `memberId?: Id`, `displayName?: string`

### `Player`

| Field | Type | Notes |
| --- | --- | --- |
| `displayName` | `string` | |
| `shirtNumber?` | `number \| string \| null` | |
| `consent` | `boolean` | Public display consent |
| `otherRoleDescription?` | `string \| null` | e.g. `"Goalkeeper"`, `"Captain"`; use `playerRole()` |
| `playerEvents` | `{ eventType, minute? }[]` | Goals and cards for this player |

### `Official`

`role: string`, `displayName: string`. `displayName` is `"Name Withheld"` when the official hasn't consented.

### `CompetitionFixtures`

`competitionId: Id`, `competitionName: string`, `competitionEntityUrlSlug?: string`, `seasonId?: Id`, `fixtures: Fixture[]`

### `LeagueTableRow`

`teamId`, `teamName`, `teamEntityUrlSlug?`, `gamesPlayed`, `gamesWon`, `gamesDrawn`, `gamesLost`, `goalsFor`, `goalsAgainst`, `goalsDifference`, `totalPoints`. Position is the array index + 1.

### `Competition`

`name: string`, `seasonName: string`, `entityUrlSlug: string`, `table?: LeagueTableRow[] | null`

### `ClubMatchDays` / `ClubMatchDay`

```ts
interface ClubMatchDays { nextMatchDay?: string | null; matchDays: ClubMatchDay[] }
interface ClubMatchDay  { id: Id; matchDay: string; competitions?: CompetitionFixtures[] }
```

### `CompetitionMatchDays` / `CompetitionMatchDay`

```ts
interface CompetitionMatchDays { nextMatchDay?: string | null; matchDays: CompetitionMatchDay[] }
interface CompetitionMatchDay  { id: Id; matchDay: string; fixtures?: Fixture[] }
```

### Client types

`GmsClientOptions`, `RequestOptions` and `GmsCache` are described in [Client reference](#client-reference) and [Caching](#caching). `TeamSummary` and `GoalScorer` are described in [Helper reference](#helper-reference).

---

## Errors

Every error thrown by a request is an instance of `GmsError`. The one exception is the `TypeError` thrown for an invalid path (an empty ID), which is a programming error.

| Class | When | Extra properties |
| --- | --- | --- |
| `GmsHttpError` | The API answered with a non-2xx status | `status`, `url`, `body` (raw text), `isNotFound` (`status === 404`) |
| `GmsNetworkError` | DNS/connection failure, timeout, or your `AbortSignal` fired | `url`, `cause` (the underlying error or abort reason) |
| `GmsParseError` | The body wasn't valid JSON | `url`, `cause` |

Common statuses:

| Status | Likely cause |
| --- | --- |
| `401` / `403` | Missing or invalid API key, or the key isn't permitted for this data |
| `404` | Unknown ID, or no data for this season |
| `429` | Too many requests. Add caching. |
| `5xx`, `504` | England Hockey API problem or timeout. Retry later. |

```ts
import { GmsError, GmsHttpError, GmsNetworkError } from 'england-hockey-gms';

try {
  const match = await gms.getFixture(id);
} catch (err) {
  if (err instanceof GmsHttpError && err.isNotFound) return show404();
  if (err instanceof GmsHttpError && (err.status === 401 || err.status === 403)) {
    log.error('GMS API key rejected'); // config problem, alert yourself
  }
  if (err instanceof GmsNetworkError) return showOfflineMessage();
  throw err;
}
```

### Retrying

The client doesn't retry automatically. A simple wrapper:

```ts
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      const retryable = err instanceof GmsNetworkError || (err instanceof GmsHttpError && err.status >= 500);
      if (!retryable || i >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 500 * 2 ** (i - 1)));
    }
  }
}

const groups = await withRetry(() => gms.getTeamFixtures(TEAM_ID));
```

---

## Caching

GMS data changes slowly: results are entered after matches, and tables update a few times a week. Caching makes your site faster and keeps you well within whatever limits England Hockey applies.

### `MemoryCache`

```ts
import { MemoryCache } from 'england-hockey-gms';

const cache = new MemoryCache(500); // max entries (default 500); oldest evicted first
const gms = new GmsClient({ apiKey, cache });

cache.clear(); // empty it, e.g. from an admin "refresh" button
```

It lives in the process's memory, so it's lost on restart and isn't shared between server instances or serverless invocations.

### Lifetimes

| Class | Default | Applies to |
| --- | --- | --- |
| `static` | 86400 s (24 h) | `getSeasons`, `getClubTeams` |
| `default` | 3600 s (1 h) | Everything else, including `request()` |

```ts
new GmsClient({ apiKey, cache, cacheTtl: { default: 600, static: 43200 } });
```

On match days you may want a shorter `default` (e.g. 5–10 minutes) so results appear sooner, or use `{ noCache: true }` on specific calls.

### Cache keys

The key is the **full request URL**, e.g. `https://ehdwapi.englandhockey.co.uk/api/teams/123/fixturesandresults`. If you share a cache store with other data, prefix keys in your adapter.

### Custom caches

Implement `GmsCache`. Methods can be sync or async. `get` must return `undefined` on a miss.

```ts
interface GmsCache {
  get(key: string): unknown | undefined | Promise<unknown | undefined>;
  set(key: string, value: unknown, ttlSeconds: number): void | Promise<void>;
}
```

**Redis (ioredis)**: shared across server instances:

```ts
import Redis from 'ioredis';
import type { GmsCache } from 'england-hockey-gms';

const redis = new Redis(process.env.REDIS_URL!);

export const redisCache: GmsCache = {
  async get(key) {
    const raw = await redis.get(`gms:${key}`);
    return raw === null ? undefined : JSON.parse(raw);
  },
  async set(key, value, ttl) {
    await redis.set(`gms:${key}`, JSON.stringify(value), 'EX', ttl);
  },
};
```

**AsyncStorage (React Native)**: survives app restarts and gives offline fallback:

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { GmsCache } from 'england-hockey-gms';

export const asyncStorageCache: GmsCache = {
  async get(key) {
    const raw = await AsyncStorage.getItem(`gms:${key}`);
    if (!raw) return undefined;
    const { value, expires } = JSON.parse(raw);
    return Date.now() < expires ? value : undefined;
  },
  async set(key, value, ttl) {
    await AsyncStorage.setItem(`gms:${key}`, JSON.stringify({ value, expires: Date.now() + ttl * 1000 }));
  },
};
```

**Browser `localStorage`**: same shape as AsyncStorage, using `localStorage.getItem` / `setItem`. Wrap them in `try/catch`, because storage can be unavailable in private browsing.

If you use a data-fetching library such as TanStack Query or SWR, or framework caching such as Next.js `revalidate`, you may not need the client cache on clients at all. Pick one caching layer per tier.

### De-duplication

If two parts of your code request the same URL at the same time, only one HTTP request is made and both get the same result. This applies to calls without a `signal`.

---

## Cancellation and timeouts

- Every request has a timeout (`timeoutMs`, default 15 s). On timeout it throws `GmsNetworkError` with the message `Timed out after 15000ms`.
- Pass `signal` to cancel. This is useful when a user navigates away or a React component unmounts.

```ts
const controller = new AbortController();
const p = gms.getTeamFixtures(123, { signal: controller.signal });
controller.abort(); // p rejects with GmsNetworkError
```

Requests that pass a `signal` aren't de-duplicated, so cancelling one caller never affects another.

---

## Proxy setups

When you proxy, **allowlist** the paths you forward. An open proxy would let anyone use your API key for anything. All examples below use this check:

```ts
// gms-allowlist.ts
const ALLOWED = [
  /^seasons$/,
  /^clubs\/[\w-]+\/teams$/,
  /^clubs\/[\w-]+\/matchdays(\/[\w-]+)?$/,
  /^teams\/[\w-]+\/fixturesandresults$/,
  /^competitions\/[\w-]+(\/table|\/matchdays(\/[\w-]+)?)?$/,
  /^fixtures\/[\w-]+$/,
];

export const isAllowedGmsPath = (path: string) => ALLOWED.some((re) => re.test(path));
```

You can tighten this further, e.g. only your club ID in `clubs/…`.

### Next.js (App Router) pass-through proxy

```ts
// app/api/gms/[...path]/route.ts
import { isAllowedGmsPath } from '@/lib/gms-allowlist';

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const joined = path.join('/');
  if (!isAllowedGmsPath(joined)) return new Response('Not found', { status: 404 });

  const upstream = await fetch(
    `https://ehdwapi.englandhockey.co.uk/api/${path.map(encodeURIComponent).join('/')}`,
    {
      headers: { 'x-api-key': process.env.GMS_API_KEY!, Accept: 'application/json' },
      next: { revalidate: 600 }, // Next.js data cache: 10 minutes
    },
  );

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, s-maxage=600, stale-while-revalidate=3600',
    },
  });
}
```

Clients then use `new GmsClient({ baseUrl: '/api/gms/' })` on the same site, or `'https://yoursite.com/api/gms/'` from the mobile app.

### Express

```ts
import express from 'express';
import { GmsClient, MemoryCache, GmsHttpError } from 'england-hockey-gms';
import { isAllowedGmsPath } from './gms-allowlist';

const app = express();
const gms = new GmsClient({ apiKey: process.env.GMS_API_KEY, cache: new MemoryCache() });

// Pass-through proxy (Express 5 wildcard syntax)
app.get('/api/gms/*path', async (req, res) => {
  const segments = (req.params as { path: string[] }).path;
  if (!isAllowedGmsPath(segments.join('/'))) return res.sendStatus(404);
  try {
    res.set('Cache-Control', 'public, max-age=300').json(await gms.request(segments));
  } catch (err) {
    res.sendStatus(err instanceof GmsHttpError ? err.status : 502);
  }
});

app.listen(3000);
```

On Express 4, use `app.get('/api/gms/*', …)` and `req.params[0].split('/')`.

### Cloudflare Worker

```ts
import { isAllowedGmsPath } from './gms-allowlist';

export default {
  async fetch(request: Request, env: { GMS_API_KEY: string }, ctx: ExecutionContext) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/gms\//, '');
    if (request.method !== 'GET' || !isAllowedGmsPath(path)) return new Response('Not found', { status: 404 });

    const cache = caches.default;
    const cached = await cache.match(request);
    if (cached) return cached;

    const upstream = await fetch(`https://ehdwapi.englandhockey.co.uk/api/${path}`, {
      headers: { 'x-api-key': env.GMS_API_KEY, Accept: 'application/json' },
    });
    const response = new Response(upstream.body, upstream);
    response.headers.set('Cache-Control', 'public, max-age=600');
    if (upstream.ok) ctx.waitUntil(cache.put(request, response.clone()));
    return response;
  },
};
```

### Protecting your proxy

- Add rate limiting (e.g. per IP) if your site is public.
- For a members-only app, require your own auth token, and send it from clients with the `headers` option:
  `new GmsClient({ baseUrl, headers: { Authorization: `Bearer ${token}` } })`.
- Set CORS headers if your website is on a different origin from the proxy. Mobile apps don't need CORS.

---

## Recipes

All recipes assume a `gms` client (on the server with the key, or on a client with a proxy `baseUrl`).

### Team page: fixtures, results, record

```ts
import { flattenFixtures, splitFixtures, summariseTeam, getScore, getOutcome, fixtureDay, fixtureTime } from 'england-hockey-gms';

export async function getTeamPage(teamId: number) {
  const groups = await gms.getTeamFixtures(teamId);
  const { upcoming, results } = splitFixtures(flattenFixtures(groups));
  const summary = summariseTeam(teamId, groups);

  return {
    name: summary.teamName,
    record: `P${summary.gamesPlayed} W${summary.gamesWon} D${summary.gamesDrawn} L${summary.gamesLost}`,
    form: summary.form.slice(-5).join(''),
    competitions: groups.map((g) => ({ id: g.competitionId, name: g.competitionName })),
    upcoming: upcoming.map((f) => ({
      id: f.id,
      date: fixtureDay(f),
      time: fixtureTime(f),
      opponent: String(f.homeTeam.id) === String(teamId) ? f.awayTeam.teamName : f.homeTeam.teamName,
      home: String(f.homeTeam.id) === String(teamId),
      venue: f.venue,
      competition: f.competitionName,
      status: f.status,
    })),
    results: results.map((f) => ({
      id: f.id,
      date: fixtureDay(f),
      home: f.homeTeam.teamName,
      away: f.awayTeam.teamName,
      score: getScore(f),
      outcome: getOutcome(f, { teamId }),
      status: f.status,
    })),
  };
}
```

### League table with your team highlighted

```ts
const table = await gms.getLeagueTable(COMP_ID);
const rows = table.map((row, i) => ({
  position: i + 1,
  ...row,
  isUs: String(row.teamId) === String(MY_TEAM_ID),
}));
```

To find a team's league competition, look through `getTeamFixtures(teamId)` groups. Leagues are the ones where `getLeagueTable` returns rows; cup competitions typically return an empty table.

### Club "this weekend" page

```ts
import { flattenFixtures, getSide, compareFixtures } from 'england-hockey-gms';

const { nextMatchDay, matchDays } = await gms.getClubMatchDays(CLUB_ID);
const next = matchDays.find((d) => d.matchDay === nextMatchDay);
const groups = next?.competitions ?? (next ? await gms.getClubMatchDay(CLUB_ID, next.id) : []);

const fixtures = flattenFixtures(groups)
  .filter((f) => !f.isBye)
  .sort(compareFixtures)
  .map((f) => ({ ...f, side: getSide(f, { clubId: CLUB_ID }) })); // 'home' | 'away'

const homeGames = fixtures.filter((f) => f.side === 'home'); // e.g. for pitch/umpire planning
```

### Club results for the last match day

```ts
const today = new Date().toISOString().slice(0, 10);
const past = matchDays.filter((d) => d.matchDay.slice(0, 10) < today);
const last = past[past.length - 1];
// import type { FlatFixture } from 'england-hockey-gms';
const results = last ? flattenFixtures(await gms.getClubMatchDay(CLUB_ID, last.id)) : [];
const line = (f: FlatFixture) => `${f.homeTeam.teamName} ${getScore(f)?.home ?? '-'}-${getScore(f)?.away ?? '-'} ${f.awayTeam.teamName}`;
```

### Club-wide form table

```ts
import { summariseTeam, rankTeams } from 'england-hockey-gms';

const teams = await gms.getClubTeams(CLUB_ID);
const summaries = await Promise.all(
  teams.map(async (t) => ({ ...summariseTeam(t.id, await gms.getTeamFixtures(t.id)), gender: t.gender })),
);
const table = rankTeams(summaries.filter((s) => s.gamesPlayed > 0));
```

This makes one request per team. With caching, that's cheap after the first load. Run it on the server.

### Match centre (fixture detail)

```ts
import { getScore, getGoalScorers, getVisiblePlayers, playerRole, formatVenueAddress, englandHockeyUrl } from 'england-hockey-gms';

const m = await gms.getFixture(FIXTURE_ID);

const side = (team: 'home' | 'away') => {
  const { players, withheld } = getVisiblePlayers(team === 'home' ? m.homePlayers : m.awayPlayers);
  return {
    name: (team === 'home' ? m.homeTeam : m.awayTeam).teamName,
    logo: (team === 'home' ? m.homeTeam : m.awayTeam).clubLogoUrl,
    scorers: getGoalScorers(team === 'home' ? m.homeTeamEvents : m.awayTeamEvents),
    lineup: players.map((p) => ({
      number: p.shirtNumber,
      name: p.displayName,
      role: playerRole(p),
      cards: p.playerEvents.filter((e) => ['GC', 'YC', 'RC'].includes(e.eventType)),
    })),
    withheld,
    staff: (team === 'home' ? m.homeTeamOfficials : m.awayTeamOfficials).filter((o) => o.displayName !== 'Name Withheld'),
  };
};

const address = formatVenueAddress(m);
const view = {
  competition: m.competitionName,
  score: getScore(m),
  status: m.status,
  home: side('home'),
  away: side('away'),
  umpires: m.officials.filter((o) => o.displayName !== 'Name Withheld'),
  venue: m.venue,
  address,
  mapUrl: address ? englandHockeyUrl.googleMaps(address) : null,
};
```

### Team dropdown grouped by gender

```ts
const teams = await gms.getClubTeams(CLUB_ID);
const byGender = Object.groupBy(teams, (t) => (t.gender === 'M' ? 'Men' : t.gender === 'F' ? 'Women' : 'Other'));
```

`Object.groupBy` needs Node 21+ or a modern browser. On older runtimes, use `reduce`.

### Calendar feed (iCalendar)

Generate `.ics` for a team so members can subscribe:

```ts
import { flattenFixtures, fixtureDay, fixtureTime, type CompetitionFixtures } from 'england-hockey-gms';

function toIcs(groups: CompetitionFixtures[]) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//yourclub//gms//EN'];
  for (const f of flattenFixtures(groups)) {
    if (f.isBye) continue;
    const day = fixtureDay(f).replace(/-/g, '');
    const time = fixtureTime(f);
    lines.push(
      'BEGIN:VEVENT',
      `UID:gms-${f.id}@yourclub.co.uk`,
      time
        ? `DTSTART;TZID=Europe/London:${day}T${time.replace(':', '')}00`
        : `DTSTART;VALUE=DATE:${day}`,
      `SUMMARY:${f.homeTeam.teamName} v ${f.awayTeam.teamName}${f.status === 'Postponed' ? ' (POSTPONED)' : ''}`,
      `LOCATION:${(f.venue ?? '').replace(/,/g, '\\,')}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
```

Serve it from a route with `Content-Type: text/calendar`.

---

## Framework integration

### Next.js server components (recommended for websites)

```ts
// lib/gms.ts — server-only
import 'server-only';
import { GmsClient, MemoryCache } from 'england-hockey-gms';

export const gms = new GmsClient({ apiKey: process.env.GMS_API_KEY, cache: new MemoryCache() });
```

```tsx
// app/teams/[id]/page.tsx
import { gms } from '@/lib/gms';
import { flattenFixtures, splitFixtures, fixtureDay, fixtureTime } from 'england-hockey-gms';

export const revalidate = 600; // re-render at most every 10 minutes

export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { upcoming } = splitFixtures(flattenFixtures(await gms.getTeamFixtures(id)));
  return (
    <ul>
      {upcoming.map((f) => (
        <li key={f.id}>
          {fixtureDay(f)} {fixtureTime(f) ?? 'TBC'}: {f.homeTeam.teamName} v {f.awayTeam.teamName}
        </li>
      ))}
    </ul>
  );
}
```

On serverless hosts, `MemoryCache` only lives for one warm instance. Rely on `revalidate` or Redis for longer-lived caching.

### React (client side) hook

```tsx
import { useEffect, useState } from 'react';
import { GmsClient, type CompetitionFixtures } from 'england-hockey-gms';

const gms = new GmsClient({ baseUrl: '/api/gms/' });

export function useTeamFixtures(teamId: number) {
  const [data, setData] = useState<CompetitionFixtures[] | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    gms.getTeamFixtures(teamId, { signal: controller.signal })
      .then(setData)
      .catch((e) => { if (!controller.signal.aborted) setError(e); });
    return () => controller.abort();
  }, [teamId]);

  return { data, error, loading: !data && !error };
}
```

### TanStack Query (React and React Native)

```ts
import { useQuery } from '@tanstack/react-query';
import { GmsClient, flattenFixtures, splitFixtures } from 'england-hockey-gms';

const gms = new GmsClient({ baseUrl: 'https://yourclub.co.uk/api/gms/' });

export const useTeamFixtures = (teamId: number) =>
  useQuery({
    queryKey: ['gms', 'team', teamId, 'fixtures'],
    queryFn: ({ signal }) => gms.getTeamFixtures(teamId, { signal }),
    select: (groups) => splitFixtures(flattenFixtures(groups)),
    staleTime: 10 * 60 * 1000,
  });

export const useLeagueTable = (competitionId: number) =>
  useQuery({
    queryKey: ['gms', 'competition', competitionId, 'table'],
    queryFn: ({ signal }) => gms.getLeagueTable(competitionId, { signal }),
    staleTime: 30 * 60 * 1000,
  });
```

### React Native / Expo

Install as normal. The package uses only `fetch` and `AbortController`, both built into React Native, so no polyfills are needed. Always use a proxy `baseUrl`, never `apiKey`:

```ts
// gms.ts
import { GmsClient } from 'england-hockey-gms';
import { asyncStorageCache } from './asyncStorageCache'; // see Caching

export const gms = new GmsClient({
  baseUrl: process.env.EXPO_PUBLIC_API_URL + '/api/gms/',
  cache: asyncStorageCache, // optional offline-friendly cache
  timeoutMs: 10000,
});
```

`EXPO_PUBLIC_*` variables are embedded in the app bundle. That's fine for a URL, but **never** for the API key.

### Plain Node scripts

```js
// list-teams.mjs — run with: GMS_API_KEY=... node list-teams.mjs 1234
import { GmsClient } from 'england-hockey-gms';

const gms = new GmsClient({ apiKey: process.env.GMS_API_KEY });
for (const t of await gms.getClubTeams(process.argv[2])) {
  console.log(t.id, t.teamName, t.gender);
}
```

---

## Displaying data responsibly

GMS holds personal data about players and officials, many of whom are juniors.

- **Respect consent.** Use `getVisiblePlayers` and show withheld players as "Name withheld". Don't display officials whose `displayName` is `"Name Withheld"`. Don't try to recover withheld names from other sources.
- **Junior teams.** Consider not showing line-ups for junior teams at all, in line with your club's safeguarding policy.
- **Attribution.** Link back to England Hockey where practical (`englandHockeyUrl`) and follow any conditions attached to your API access.
- **Don't store more than you need.** If you persist API data, e.g. in a database, apply your club's data protection and retention policies to it.

---

## Testing your code

Inject a fake `fetch` to test code that uses the client, with no network or key needed:

```ts
import { GmsClient } from 'england-hockey-gms';

const fakeFetch = async (url: string) => {
  if (url.endsWith('/teams/1/fixturesandresults')) {
    return new Response(JSON.stringify([{ competitionId: 5, competitionName: 'Div 1', fixtures: [] }]));
  }
  return new Response('not found', { status: 404 });
};

const gms = new GmsClient({ fetch: fakeFetch });
```

Helpers accept a `now` date so tests don't depend on today's date:

```ts
splitFixtures(fixtures, new Date('2025-10-15T12:00:00'));
summariseTeam(1, groups, new Date('2025-10-15T12:00:00'));
```

---

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `GmsHttpError` 401/403 | Key missing, wrong or not authorised. Check `GMS_API_KEY` is set **on the server**, and contact GMS support. |
| `GmsHttpError` 404 | Wrong ID, wrong entity type (e.g. a team ID passed to a competition method), or no data this season. |
| `GmsNetworkError: Timed out after 15000ms` | The API is slow, especially for large clubs. Increase `timeoutMs` or add caching. |
| CORS error in the browser | You're calling England Hockey directly from the browser. Use a [proxy](#proxy-setups) instead. |
| `No fetch implementation available` | Node < 18. Upgrade Node, or pass `fetch` (e.g. from `undici`). |
| Fixtures show on the wrong day around midnight | Server time zone. Set `TZ=Europe/London` or pass `now`. |
| Next match day has fixtures, others don't | Expected. Call `getClubMatchDay` / `getCompetitionMatchDay` for other days. |
| Table is empty | Cup competition, or the season hasn't started. `getLeagueTable` already falls back to the table endpoint. |
| A field is `undefined` though typed as required | The API may differ from the inferred types. Log the raw response and [report it](#contributing-and-releasing). |
| `ERR_REQUIRE_ESM` or similar | Shouldn't happen, because both formats are shipped. Make sure you're importing `'england-hockey-gms'`, not a `dist/` path. |

To see exactly what the API returns:

```ts
const raw = await gms.request(['teams', TEAM_ID, 'fixturesandresults']);
console.log(JSON.stringify(raw, null, 2));
```

---

## Limitations and known unknowns

- **Types aren't verified against live data.** They're based on the fields England Hockey's own plugin reads. The real API may return extra fields (not typed) or differ in nullability or ID types. Use `request()` or cast if you need untyped fields.
- **Current season only.** Team fixtures and match days cover the current season. Accessing past seasons isn't documented.
- **Read-only.** The API doesn't support entering results or team sheets.
- **Rate limits unknown.** England Hockey hasn't published limits. Cache generously and don't poll aggressively.
- **No search endpoint.** You can't look up clubs or teams by name; you need IDs.
- **Upstream changes.** England Hockey may change the API without notice. Pin a version range (`^0.1.0`) and watch for updates.

---

## Contributing and releasing

Source: https://github.com/KingCharlesVI/gms-wrapper. npm: https://www.npmjs.com/package/england-hockey-gms

```sh
git clone https://github.com/KingCharlesVI/gms-wrapper
cd gms-wrapper
npm install
npm test           # run the Vitest suite
npm run typecheck  # tsc --noEmit
npm run build      # tsup → dist/ (ESM, CJS, .d.ts)
```

Project layout:

```
src/
  client.ts    GmsClient: endpoints, fetch, caching, errors
  types.ts     API response types
  helpers.ts   Pure helper functions
  cache.ts     GmsCache interface and MemoryCache
  errors.ts    Error classes
  index.ts     Public exports
test/          Vitest tests (mocked fetch, no network)
```

The build uses tsup with **TypeScript 5**. TypeScript 7 currently breaks tsup's declaration build.

**Reporting a type mismatch:** open an issue with the endpoint, the field, and a snippet of the raw JSON, with personal data removed.

**Releasing:**

```sh
npm version patch   # or minor / major; commits and tags
npm publish         # runs typecheck, tests and build first
git push --follow-tags
```

Publishing needs an npm granular access token with read/write access and "bypass 2FA" enabled, or an interactive `--otp` code.

Versioning follows semver. While on `0.x`, minor versions may include breaking type changes as the types are verified against real data.

---

## License

MIT © KingCharlesVI
