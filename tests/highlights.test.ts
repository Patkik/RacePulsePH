import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPlaylistRules,
  DEFAULT_MARQUEE_CONFIG,
  deriveRaceCode,
  isHighlightExpired,
  normalizeHighlightConfig,
  parsePacePulseMs,
  sanitizeHexColor,
  sanitizeHighlightPayload,
} from '../src/lib/highlights.ts';
import type { RunnerHighlight } from '../src/types.ts';

function makeHighlight(overrides: Partial<RunnerHighlight> = {}): RunnerHighlight {
  return {
    id: 'hl_base',
    mode: 'solo',
    runnerName: 'Marco Reyes',
    bibNumber: '21-01',
    placement: 'Finisher',
    distance: '21K',
    chipTime: '01:28:12',
    pace: '4:11 /km',
    raceName: 'Manila Dawn Half',
    raceDate: '2026-11-01',
    photoUrl: 'data:image/jpeg;base64,abc',
    borderPreset: 'liquid-gold',
    cornerGeometry: 'rounded',
    accentColor: '#f5b731',
    glowIntensity: 75,
    surfaceFinish: 'glossy',
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    ...overrides,
  };
}

test('parsePacePulseMs maps faster paces to shorter pulse periods', () => {
  const fast = parsePacePulseMs('3:15 /km');
  const moderate = parsePacePulseMs('5:30 /km');
  const slow = parsePacePulseMs('8:30 /km');
  assert.ok(fast < moderate);
  assert.ok(moderate < slow);
  assert.ok(fast >= 560 && slow <= 1650);
});

test('applyPlaylistRules filters expired cards, applies race filter, and prioritizes pinned & podium finishers', () => {
  const items: RunnerHighlight[] = [
    makeHighlight({ id: 'h_finisher', placement: 'Finisher', raceId: 'r1', raceDate: '2026-10-01' }),
    makeHighlight({ id: 'h_1st', placement: '1st', raceId: 'r2', raceDate: '2026-11-01' }),
    makeHighlight({ id: 'h_pinned', placement: 'Top 10', pinned: true, raceId: 'r2', raceDate: '2026-11-01' }),
    makeHighlight({ id: 'h_expired', placement: 'Record Holder', expiresAt: '2026-10-15', raceId: 'r2', raceDate: '2026-11-01' }),
  ];

  const filtered = applyPlaylistRules(
    items,
    { ...DEFAULT_MARQUEE_CONFIG, pinPodiumFirst: true, hideExpired: true, filterRaceId: 'r2' },
    '2026-11-10',
  );

  assert.deepEqual(
    filtered.map((x) => x.id),
    ['h_pinned', 'h_1st'],
  );

  const latestOnly = applyPlaylistRules(
    items,
    { ...DEFAULT_MARQUEE_CONFIG, pinPodiumFirst: true, hideExpired: false, filterRaceId: 'latest' },
    '2026-11-10',
  );
  assert.equal(latestOnly[0].id, 'h_pinned');
  assert.ok(latestOnly.every((x) => x.raceId === 'r2'));
});

test('sanitizeHighlightPayload caps lengths, cleans hex accents, and omits invalid duo fields on solo mode', () => {
  const dirty = makeHighlight({
    id: 'hl test!@#',
    mode: 'solo',
    runnerName: 'A'.repeat(100),
    accentColor: 'invalid-color',
    glowIntensity: 999,
    partnerName: 'Should Be Stripped',
  });
  const clean = sanitizeHighlightPayload(dirty);
  assert.equal(clean.id, 'hltest');
  assert.equal(clean.runnerName.length, 36);
  assert.equal(clean.accentColor, '#ff3b30');
  assert.equal(clean.glowIntensity, 100);
  assert.equal('partnerName' in clean, false);
});

test('normalizeHighlightConfig clamps speed, cardGap, and edgeFade bounds', () => {
  const cfg = normalizeHighlightConfig({ speedPxPerSec: 999, cardGapPx: 2, edgeFadePx: 500, direction: 'right' });
  assert.equal(cfg.speedPxPerSec, 120);
  assert.equal(cfg.cardGapPx, 12);
  assert.equal(cfg.edgeFadePx, 120);
  assert.equal(cfg.direction, 'right');
});

test('isHighlightExpired, sanitizeHexColor, and deriveRaceCode behave deterministically', () => {
  assert.equal(isHighlightExpired({ expiresAt: '2026-01-01' }, '2026-02-01'), true);
  assert.equal(isHighlightExpired({ expiresAt: '2026-03-01' }, '2026-02-01'), false);
  assert.equal(sanitizeHexColor('#abc'), '#aabbcc');
  assert.equal(deriveRaceCode('Manila Dawn Half Marathon', '2026-11-15'), 'MAN-DAW-HAL-2026');
});
