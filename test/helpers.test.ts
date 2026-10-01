import { describe, expect, it } from 'vitest';
import {
  fixtureTime,
  flattenFixtures,
  getFixtureState,
  getGoalScorers,
  getOutcome,
  getScore,
  getVisiblePlayers,
  rankTeams,
  splitFixtures,
  summariseTeam,
  type CompetitionFixtures,
  type Fixture,
} from '../src/index.js';

const NOW = new Date('2025-10-15T12:00:00');

function fixture(overrides: Partial<Fixture> = {}): Fixture {
  return {
    id: 1,
    fixtureDate: '2025-10-11T00:00:00',
    fixtureTime: '14:00',
    homeTeam: { id: 10, teamName: 'Home 1s', gender: 'M', clubId: 100 },
    awayTeam: { id: 20, teamName: 'Away 1s', gender: 'M', clubId: 200 },
    homeTeamScore: '3',
    awayTeamScore: '1',
    homeTeamScoreAsInt: 3,
    awayTeamScoreAsInt: 1,
    isResult: true,
    isBye: false,
    status: 'Result',
    ...overrides,
  };
}

const upcoming = (overrides: Partial<Fixture> = {}) =>
  fixture({ fixtureDate: '2025-10-18T00:00:00', isResult: false, status: 'Active', homeTeamScore: null, awayTeamScore: null, homeTeamScoreAsInt: null, awayTeamScoreAsInt: null, ...overrides });

describe('fixture state and scores', () => {
  it('classifies fixtures', () => {
    expect(getFixtureState(fixture(), NOW)).toBe('result');
    expect(getFixtureState(upcoming(), NOW)).toBe('upcoming');
    expect(getFixtureState(upcoming({ fixtureDate: '2025-10-04T00:00:00' }), NOW)).toBe('awaiting-result');
    expect(getFixtureState(fixture({ homeTeamScore: 'P', awayTeamScore: 'P', status: 'Result' }), NOW)).toBe('postponed');
    expect(getFixtureState(fixture({ status: 'Cancelled' }), NOW)).toBe('cancelled');
    expect(getFixtureState(fixture({ isBye: true }), NOW)).toBe('bye');
  });

  it('treats 00:00 as no time', () => {
    expect(fixtureTime(fixture({ fixtureTime: '00:00' }))).toBeNull();
    expect(fixtureTime(fixture())).toBe('14:00');
  });

  it('reads scores and shootouts', () => {
    expect(getScore(fixture())).toEqual({ home: 3, away: 1 });
    expect(getScore(fixture({ homeTeamScoreAsInt: undefined, homeTeamScore: '2', awayTeamScoreAsInt: undefined, awayTeamScore: 2, homeTeamShootoutScore: 3, awayTeamShootoutScore: 2 }))).toEqual({
      home: 2,
      away: 2,
      shootout: { home: 3, away: 2 },
    });
    expect(getScore(upcoming())).toBeNull();
    expect(getScore(fixture({ homeTeamScore: 'P', awayTeamScore: 'P', homeTeamScoreAsInt: null, awayTeamScoreAsInt: null }))).toBeNull();
  });

  it('computes outcomes by team or club, with mixed id types', () => {
    expect(getOutcome(fixture(), { teamId: 10 })).toBe('W');
    expect(getOutcome(fixture(), { teamId: '20' })).toBe('L');
    expect(getOutcome(fixture(), { clubId: 200 })).toBe('L');
    expect(getOutcome(fixture({ homeTeamScoreAsInt: 1 }), { teamId: 20 })).toBe('D');
    expect(getOutcome(fixture(), { teamId: 999 })).toBeNull();
  });
});

describe('lists and summaries', () => {
  const groups: CompetitionFixtures[] = [
    {
      competitionId: 5,
      competitionName: 'Division 1',
      fixtures: [
        fixture({ id: 2, fixtureDate: '2025-10-04T00:00:00', homeTeamScoreAsInt: 0, awayTeamScoreAsInt: 0 }),
        upcoming({ id: 4 }),
        fixture({ id: 5, isBye: true, fixtureDate: '2025-09-27T00:00:00' }),
      ],
    },
    { competitionId: 6, competitionName: 'Cup', fixtures: [fixture({ id: 3 }), upcoming({ id: 6, fixtureDate: '2025-10-20T00:00:00', status: 'Postponed' })] },
  ];

  it('flattens and sorts by date, tagging competition', () => {
    const flat = flattenFixtures(groups);
    expect(flat.map((f) => f.id)).toEqual([5, 2, 3, 4, 6]);
    expect(flat.find((f) => f.id === 3)?.competitionName).toBe('Cup');
  });

  it('splits upcoming and results', () => {
    const { upcoming: next, results } = splitFixtures(flattenFixtures(groups), NOW);
    expect(next.map((f) => f.id)).toEqual([4, 6]);
    expect(results.map((f) => f.id)).toEqual([3, 2]);
  });

  it('summarises a team', () => {
    const summary = summariseTeam(10, groups, NOW);
    expect(summary).toMatchObject({
      teamName: 'Home 1s',
      gamesPlayed: 2,
      gamesWon: 1,
      gamesDrawn: 1,
      gamesLost: 0,
      goalsFor: 3,
      goalsAgainst: 1,
      goalsDifference: 2,
      totalPoints: 4,
      pointsPerGame: 2,
      form: ['D', 'W'],
    });
    expect(summary.nextFixture?.id).toBe(4);
  });

  it('ranks teams by PPG then GD', () => {
    const ranked = rankTeams([
      { id: 'a', pointsPerGame: 1, goalsDifference: 5, goalsFor: 9, gamesWon: 1 },
      { id: 'b', pointsPerGame: 2, goalsDifference: 0, goalsFor: 1, gamesWon: 1 },
      { id: 'c', pointsPerGame: 1, goalsDifference: 6, goalsFor: 1, gamesWon: 1 },
    ]);
    expect(ranked.map((t) => t.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('fixture detail helpers', () => {
  it('groups goal scorers and ignores cards', () => {
    expect(
      getGoalScorers([
        { eventType: 'FG', minute: 12, memberId: 1, displayName: 'A Player' },
        { eventType: 'YC', minute: 20, memberId: 1, displayName: 'A Player' },
        { eventType: 'PC', minute: 40, memberId: 1, displayName: 'A Player' },
        { eventType: 'PS', minute: null, memberId: 2, displayName: 'B Player' },
      ]),
    ).toEqual([
      { memberId: 1, name: 'A Player', goals: [{ minute: 12, type: 'FG' }, { minute: 40, type: 'PC' }] },
      { memberId: 2, name: 'B Player', goals: [{ minute: null, type: 'PS' }] },
    ]);
  });

  it('withholds non-consenting players without shirt numbers', () => {
    const result = getVisiblePlayers([
      { displayName: 'Yes', consent: true, playerEvents: [] },
      { displayName: 'Numbered', consent: false, shirtNumber: 7, playerEvents: [] },
      { displayName: 'Hidden', consent: false, playerEvents: [] },
    ]);
    expect(result.players.map((p) => p.displayName)).toEqual(['Yes', 'Numbered']);
    expect(result.withheld).toBe(1);
  });
});
