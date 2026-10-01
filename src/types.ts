/**
 * Response types for the England Hockey GMS data API.
 *
 * There is no published schema for this API. These types are derived from the
 * fields consumed by England Hockey's own "Hockey GMS Feed" WordPress plugin,
 * so fields the plugin never reads are not listed here (the API may return
 * more). Fields the plugin treats as possibly absent are marked optional.
 */

export type Id = number | string;

/** `M` = men's/boys', `F` = women's/girls'. Mixed teams may use other values. */
export type Gender = 'M' | 'F' | (string & {});

/** Known fixture statuses. */
export type FixtureStatus =
  | 'Active'
  | 'Result'
  | 'Bye'
  | 'Postponed'
  | 'Cancelled'
  | (string & {});

/**
 * Match event codes.
 * - `FG` field goal, `PC` penalty corner goal, `PS` penalty stroke goal
 * - `GC` green card, `YC` yellow card, `RC` red card
 */
export type EventType = 'FG' | 'PC' | 'PS' | 'GC' | 'YC' | 'RC' | (string & {});

export interface Season {
  id: Id;
  /** e.g. "2025-2026" */
  description: string;
}

export interface Team {
  id: Id;
  teamName: string;
  gender: Gender;
  clubId: Id;
  clubName: string;
  /** Slug for `https://www.englandhockey.co.uk/teams/{slug}` */
  entityUrlSlug: string;
  /** Slug for `https://www.englandhockey.co.uk/clubs/{slug}` */
  clubUrlSlug: string;
  clubLogoUrl?: string | null;
}

/** A team as embedded in a fixture. */
export interface FixtureTeam {
  id: Id;
  teamName: string;
  gender: Gender;
  clubId?: Id;
  entityUrlSlug?: string;
  clubUrlSlug?: string;
  clubLogoUrl?: string | null;
}

export interface Fixture {
  id: Id;
  /** ISO date/datetime string, e.g. "2025-09-20T00:00:00" */
  fixtureDate: string;
  /** "HH:mm"; "00:00" means time not set */
  fixtureTime: string;
  homeTeamId?: Id;
  awayTeamId?: Id;
  homeTeam: FixtureTeam;
  awayTeam: FixtureTeam;
  /** Score as text. "P" = postponed, "C" = cancelled. */
  homeTeamScore: string | number | null;
  awayTeamScore: string | number | null;
  homeTeamScoreAsInt?: number | null;
  awayTeamScoreAsInt?: number | null;
  homeTeamShootoutScore?: number | null;
  awayTeamShootoutScore?: number | null;
  isResult: boolean;
  isBye: boolean;
  status: FixtureStatus;
  venue?: string | null;
  competitionId?: Id;
  competitionName?: string;
  competitionEntityUrlSlug?: string;
}

export interface MatchEvent {
  eventType: EventType;
  minute?: number | string | null;
  memberId?: Id;
  displayName?: string;
}

export interface PlayerEvent {
  eventType: EventType;
  minute?: number | string | null;
}

export interface Player {
  displayName: string;
  shirtNumber?: number | string | null;
  /** Whether the player consented to having their name shown publicly. */
  consent: boolean;
  /** e.g. "Goalkeeper" / "GK", "Captain" / "CAPT" */
  otherRoleDescription?: string | null;
  playerEvents: PlayerEvent[];
}

export interface Official {
  role: string;
  /** "Name Withheld" when the official has not consented. */
  displayName: string;
}

export interface VenueDetails {
  address?: string | null;
  postCode?: string | null;
}

/** Full fixture details from `GET fixtures/{id}`. */
export interface FixtureDetail extends Fixture {
  venueDetails?: VenueDetails | null;
  homeTeamEvents: MatchEvent[];
  awayTeamEvents: MatchEvent[];
  homePlayers: Player[];
  awayPlayers: Player[];
  homeTeamOfficials: Official[];
  awayTeamOfficials: Official[];
  /** Match officials (umpires etc.) */
  officials: Official[];
}

/** A group of fixtures belonging to one competition. */
export interface CompetitionFixtures {
  competitionId: Id;
  competitionName: string;
  competitionEntityUrlSlug?: string;
  seasonId?: Id;
  fixtures: Fixture[];
}

export interface LeagueTableRow {
  teamId: Id;
  teamName: string;
  teamEntityUrlSlug?: string;
  gamesPlayed: number;
  gamesWon: number;
  gamesDrawn: number;
  gamesLost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalsDifference: number;
  totalPoints: number;
}

export interface Competition {
  name: string;
  seasonName: string;
  entityUrlSlug: string;
  /** Present for league competitions; may be empty, in which case use `getCompetitionTable`. */
  table?: LeagueTableRow[] | null;
}

export interface ClubMatchDay {
  id: Id;
  /** ISO date string */
  matchDay: string;
  /** Only populated for the next match day; fetch others with `getClubMatchDay`. */
  competitions?: CompetitionFixtures[];
}

export interface ClubMatchDays {
  /** ISO date string of the next match day */
  nextMatchDay?: string | null;
  matchDays: ClubMatchDay[];
}

export interface CompetitionMatchDay {
  id: Id;
  /** ISO date string */
  matchDay: string;
  /** Only populated for the next match day; fetch others with `getCompetitionMatchDay`. */
  fixtures?: Fixture[];
}

export interface CompetitionMatchDays {
  nextMatchDay?: string | null;
  matchDays: CompetitionMatchDay[];
}
