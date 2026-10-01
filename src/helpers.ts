import type { CompetitionFixtures, Fixture, FixtureDetail, Id, MatchEvent, Player } from './types.js';

export type FixtureState = 'bye' | 'postponed' | 'cancelled' | 'result' | 'awaiting-result' | 'upcoming';
export type Outcome = 'W' | 'D' | 'L';

const GOAL_EVENTS = new Set(['FG', 'PC', 'PS']);

const sameId = (a: Id | undefined | null, b: Id | undefined | null) =>
  a !== undefined && a !== null && b !== undefined && b !== null && String(a) === String(b);

/** Today's date as `YYYY-MM-DD` in the runtime's local time zone. */
function localToday(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The fixture's date as `YYYY-MM-DD` (GMS dates are UK local dates). */
export function fixtureDay(fixture: Pick<Fixture, 'fixtureDate'>): string {
  return fixture.fixtureDate.slice(0, 10);
}

/** The start time as `HH:mm`, or `null` when GMS has no time set ("00:00"). */
export function fixtureTime(fixture: Pick<Fixture, 'fixtureTime'>): string | null {
  const time = fixture.fixtureTime?.slice(0, 5);
  return time && time !== '00:00' ? time : null;
}

export function isPostponed(fixture: Fixture): boolean {
  return fixture.status === 'Postponed' || (fixture.homeTeamScore === 'P' && fixture.awayTeamScore === 'P');
}

export function isCancelled(fixture: Fixture): boolean {
  return fixture.status === 'Cancelled' || (fixture.homeTeamScore === 'C' && fixture.awayTeamScore === 'C');
}

/** Classifies a fixture. A past fixture with no result recorded is `awaiting-result`. */
export function getFixtureState(fixture: Fixture, now: Date = new Date()): FixtureState {
  if (fixture.isBye) return 'bye';
  if (isPostponed(fixture)) return 'postponed';
  if (isCancelled(fixture)) return 'cancelled';
  if (fixture.isResult) return 'result';
  return fixtureDay(fixture) < localToday(now) ? 'awaiting-result' : 'upcoming';
}

function numericScore(asInt: number | null | undefined, raw: Fixture['homeTeamScore']): number | null {
  if (typeof asInt === 'number') return asInt;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) return Number(raw);
  return null;
}

/** Numeric score, or `null` if no result or the match was postponed/cancelled. */
export function getScore(fixture: Fixture): { home: number; away: number; shootout?: { home: number; away: number } } | null {
  if (!fixture.isResult || fixture.isBye || isPostponed(fixture) || isCancelled(fixture)) return null;
  const home = numericScore(fixture.homeTeamScoreAsInt, fixture.homeTeamScore);
  const away = numericScore(fixture.awayTeamScoreAsInt, fixture.awayTeamScore);
  if (home === null || away === null) return null;
  const hs = fixture.homeTeamShootoutScore ?? 0;
  const as = fixture.awayTeamShootoutScore ?? 0;
  return hs > 0 || as > 0 ? { home, away, shootout: { home: hs, away: as } } : { home, away };
}

/** Which side of the fixture a team or club is on. Matches by team ID first, then club ID. */
export function getSide(fixture: Fixture, ref: { teamId?: Id; clubId?: Id }): 'home' | 'away' | null {
  if (sameId(fixture.homeTeam?.id ?? fixture.homeTeamId, ref.teamId)) return 'home';
  if (sameId(fixture.awayTeam?.id ?? fixture.awayTeamId, ref.teamId)) return 'away';
  if (sameId(fixture.homeTeam?.clubId, ref.clubId)) return 'home';
  if (sameId(fixture.awayTeam?.clubId, ref.clubId)) return 'away';
  return null;
}

/** W/D/L from the perspective of a team (or club), ignoring shootouts. `null` if not applicable. */
export function getOutcome(fixture: Fixture, ref: { teamId?: Id; clubId?: Id }): Outcome | null {
  const score = getScore(fixture);
  const side = getSide(fixture, ref);
  if (!score || !side) return null;
  if (score.home === score.away) return 'D';
  return (score.home > score.away) === (side === 'home') ? 'W' : 'L';
}

export interface FlatFixture extends Fixture {
  competitionId: Id;
  competitionName: string;
}

/** Flattens competition-grouped fixtures into one list sorted by date and time, tagging each with its competition. */
export function flattenFixtures(groups: CompetitionFixtures[]): FlatFixture[] {
  return groups
    .flatMap((group) =>
      group.fixtures.map((fixture) => ({
        ...fixture,
        competitionId: fixture.competitionId ?? group.competitionId,
        competitionName: fixture.competitionName ?? group.competitionName,
      })),
    )
    .sort((a, b) => compareFixtures(a, b));
}

/** Sort comparator: by date, then time. */
export function compareFixtures(a: Fixture, b: Fixture): number {
  return fixtureDay(a).localeCompare(fixtureDay(b)) || (a.fixtureTime ?? '').localeCompare(b.fixtureTime ?? '');
}

/**
 * Splits fixtures into upcoming ones and results (most recent first), dropping byes.
 * Past fixtures with no result go in `results` so they aren't shown as upcoming;
 * postponed/cancelled fixtures stay in `upcoming` until their original date passes.
 */
export function splitFixtures<T extends Fixture>(fixtures: T[], now: Date = new Date()): { upcoming: T[]; results: T[] } {
  const upcoming: T[] = [];
  const results: T[] = [];
  for (const fixture of fixtures) {
    const state = getFixtureState(fixture, now);
    if (state === 'bye') continue;
    const offOnFutureDate = (state === 'postponed' || state === 'cancelled') && fixtureDay(fixture) >= localToday(now);
    if (state === 'upcoming' || offOnFutureDate) {
      upcoming.push(fixture);
    } else {
      results.push(fixture);
    }
  }
  upcoming.sort(compareFixtures);
  results.sort((a, b) => compareFixtures(b, a));
  return { upcoming, results };
}

export interface TeamSummary {
  teamId: Id;
  teamName: string | null;
  gamesPlayed: number;
  gamesWon: number;
  gamesDrawn: number;
  gamesLost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalsDifference: number;
  /** 3 for a win, 1 for a draw. */
  totalPoints: number;
  pointsPerGame: number;
  /** Oldest first. */
  form: Outcome[];
  nextFixture: FlatFixture | null;
}

/**
 * Aggregates a team's record across all competitions (e.g. from `getTeamFixtures`).
 * Postponed, cancelled and bye fixtures are excluded.
 */
export function summariseTeam(teamId: Id, groups: CompetitionFixtures[], now: Date = new Date()): TeamSummary {
  const summary: TeamSummary = {
    teamId,
    teamName: null,
    gamesPlayed: 0,
    gamesWon: 0,
    gamesDrawn: 0,
    gamesLost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalsDifference: 0,
    totalPoints: 0,
    pointsPerGame: 0,
    form: [],
    nextFixture: null,
  };
  for (const fixture of flattenFixtures(groups)) {
    const side = getSide(fixture, { teamId });
    if (!side) continue;
    summary.teamName ??= side === 'home' ? fixture.homeTeam.teamName : fixture.awayTeam.teamName;
    if (getFixtureState(fixture, now) === 'upcoming') {
      summary.nextFixture ??= fixture;
      continue;
    }
    const score = getScore(fixture);
    const outcome = getOutcome(fixture, { teamId });
    if (!score || !outcome) continue;
    summary.gamesPlayed++;
    summary.goalsFor += side === 'home' ? score.home : score.away;
    summary.goalsAgainst += side === 'home' ? score.away : score.home;
    if (outcome === 'W') summary.gamesWon++;
    else if (outcome === 'D') summary.gamesDrawn++;
    else summary.gamesLost++;
    summary.form.push(outcome);
  }
  summary.goalsDifference = summary.goalsFor - summary.goalsAgainst;
  summary.totalPoints = summary.gamesWon * 3 + summary.gamesDrawn;
  summary.pointsPerGame = summary.gamesPlayed ? Math.round((summary.totalPoints / summary.gamesPlayed) * 100) / 100 : 0;
  return summary;
}

/** Sorts summaries the way the GMS Feed plugin does: PPG, then GD, goals for, wins. */
export function rankTeams<T extends Pick<TeamSummary, 'pointsPerGame' | 'goalsDifference' | 'goalsFor' | 'gamesWon'>>(teams: T[]): T[] {
  return [...teams].sort(
    (a, b) =>
      b.pointsPerGame - a.pointsPerGame ||
      b.goalsDifference - a.goalsDifference ||
      b.goalsFor - a.goalsFor ||
      b.gamesWon - a.gamesWon,
  );
}

export interface GoalScorer {
  memberId?: Id;
  name: string;
  goals: Array<{ minute: number | string | null; type: string }>;
}

/** Groups goal events (field goal, penalty corner, penalty stroke) by player. */
export function getGoalScorers(events: MatchEvent[]): GoalScorer[] {
  const scorers = new Map<string, GoalScorer>();
  for (const event of events ?? []) {
    if (!GOAL_EVENTS.has(event.eventType)) continue;
    const key = String(event.memberId ?? event.displayName ?? '');
    let scorer = scorers.get(key);
    if (!scorer) {
      scorer = { memberId: event.memberId, name: event.displayName ?? 'Unknown', goals: [] };
      scorers.set(key, scorer);
    }
    scorer.goals.push({ minute: event.minute ?? null, type: event.eventType });
  }
  return [...scorers.values()];
}

/**
 * Players who may be shown publicly, plus a count of withheld names.
 * GMS withholds players who have not given consent and have no shirt number.
 */
export function getVisiblePlayers(players: Player[]): { players: Player[]; withheld: number } {
  const visible: Player[] = [];
  let withheld = 0;
  for (const player of players ?? []) {
    if (player.consent || (player.shirtNumber !== undefined && player.shirtNumber !== null)) visible.push(player);
    else withheld++;
  }
  return { players: visible, withheld };
}

/** Short role tag: `GK` for goalkeeper, `C` for captain, otherwise `null`. */
export function playerRole(player: Player): 'GK' | 'C' | null {
  switch (player.otherRoleDescription) {
    case 'Goalkeeper':
    case 'GK':
      return 'GK';
    case 'Captain':
    case 'CAPT':
      return 'C';
    default:
      return null;
  }
}

/** Venue as a single address line, e.g. for maps links. */
export function formatVenueAddress(fixture: Pick<FixtureDetail, 'venue' | 'venueDetails'>): string | null {
  const address = fixture.venueDetails?.address?.replace(/(\w+,)(\w+)/g, '$1 $2');
  const parts = [address, fixture.venueDetails?.postCode].filter(Boolean);
  if (parts.length) return parts.join(', ');
  return fixture.venue ?? null;
}

/** Links to the public England Hockey website. */
export const englandHockeyUrl = {
  club: (slug: string) => `https://www.englandhockey.co.uk/clubs/${slug}`,
  team: (slug: string) => `https://www.englandhockey.co.uk/teams/${slug}`,
  competition: (slug: string) => `https://www.englandhockey.co.uk/competitions/${slug}`,
  googleMaps: (query: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`,
};
