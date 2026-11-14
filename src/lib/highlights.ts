import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  setDoc,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { db, storage } from '../firebase';
import {
  HighlightBorderPreset,
  HighlightCardLayoutMode,
  HighlightCornerGeometry,
  HighlightFlowDirection,
  HighlightHoverBehavior,
  HighlightPlacement,
  HighlightsMarqueeConfig,
  HighlightSurfaceFinish,
  RunnerHighlight,
} from '../types';

export const DEFAULT_MARQUEE_CONFIG: HighlightsMarqueeConfig = {
  speedPxPerSec: 44,
  hoverBehavior: 'stop',
  direction: 'left',
  layoutMode: 'card',
  cardGapPx: 20,
  edgeFadePx: 48,
  pinPodiumFirst: true,
  filterRaceId: '',
  hideExpired: true,
};

export const HIGHLIGHT_BORDER_PRESETS: ReadonlyArray<{
  id: HighlightBorderPreset;
  label: string;
  summary: string;
  defaultAccent: string;
}> = [
  {
    id: 'liquid-gold',
    label: 'Liquid Gold',
    summary: 'Dual rotating conic frame with rising bottom ember particles.',
    defaultAccent: '#f5b731',
  },
  {
    id: 'cyber-hud',
    label: 'Cyber HUD',
    summary: '45 deg chamfered corners, locking brackets, and race-code ticker.',
    defaultAccent: '#22d3ee',
  },
  {
    id: 'sonic-wave',
    label: 'Sonic Wave',
    summary: 'Pace-synced pulsing perimeter wave tied to runner speed.',
    defaultAccent: '#ff3b30',
  },
  {
    id: 'holo-foil',
    label: 'Holo Foil',
    summary: 'Iridescent spectrum border that shifts hue across the viewport.',
    defaultAccent: '#a855f7',
  },
  {
    id: 'carbon-minimal',
    label: 'Carbon Minimal',
    summary: 'Woven carbon bezel with razor-thin top and bottom laser rules.',
    defaultAccent: '#ff3b30',
  },
];

export const HIGHLIGHT_CORNER_GEOMETRIES: ReadonlyArray<{
  id: HighlightCornerGeometry;
  label: string;
  detail: string;
}> = [
  { id: 'rounded', label: 'Rounded (16px)', detail: 'Soft broadcast trading card corners' },
  { id: 'sharp', label: 'Sharp (0px)', detail: 'Squared editorial slab geometry' },
  { id: 'tactical', label: 'Tactical Cut', detail: '45 deg chamfered telemetry polygon' },
];

export const HIGHLIGHT_SURFACE_FINISHES: ReadonlyArray<{
  id: HighlightSurfaceFinish;
  label: string;
}> = [
  { id: 'matte', label: 'Matte' },
  { id: 'glossy', label: 'Glossy Sweep' },
  { id: 'topo', label: 'Topo Map' },
];

export const HIGHLIGHT_PLACEMENTS: readonly HighlightPlacement[] = [
  '1st',
  '2nd',
  '3rd',
  'Top 10',
  'Finisher',
  'Record Holder',
];

export const HIGHLIGHT_DISTANCES = ['5K', '10K', '16K', '21K', '32K', '42K', '50K'] as const;

export const HIGHLIGHT_CAPS = {
  runnerName: 36,
  bibNumber: 16,
  placement: 24,
  distance: 16,
  chipTime: 18,
  gunTime: 18,
  pace: 18,
  splitPace: 18,
  raceName: 48,
  raceCode: 20,
  raceDate: 20,
  runClub: 34,
  badgeStamp: 22,
} as const;

export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function sanitizeHexColor(input: string | undefined, fallback = '#ff3b30'): string {
  const trimmed = (input || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const [, r, g, b] = trimmed.split('');
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return fallback;
}

export function capText(value: string | undefined, max: number): string {
  return (value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

/**
 * Parses a pace string such as "3:45 /km" or "04:12" and converts it into a
 * heartbeat animation period in milliseconds (faster pace = shorter period).
 */
export function parsePacePulseMs(pace: string | undefined): number {
  const match = (pace || '').match(/(\d{1,2})\s*[:.]\s*(\d{2})/);
  if (!match) return 1100;
  const mins = Number(match[1]);
  const secs = Number(match[2]);
  const totalSec = mins * 60 + secs;
  // Map 180s (3:00/km) -> 560ms, 540s (9:00/km) -> 1650ms
  const normalized = clampNumber((totalSec - 180) / (540 - 180), 0, 1);
  return Math.round(560 + normalized * (1650 - 560));
}

export function placementRankWeight(placement: string | undefined): number {
  const text = (placement || '').trim().toLowerCase();
  if (text.includes('record')) return 0;
  if (text === '1st' || text.startsWith('1st ') || text.includes('champion')) return 1;
  if (text === '2nd' || text.startsWith('2nd ')) return 2;
  if (text === '3rd' || text.startsWith('3rd ')) return 3;
  if (text.includes('top 10') || text.includes('top10')) return 4;
  return 5;
}

export function isHighlightExpired(item: Pick<RunnerHighlight, 'expiresAt'>, nowIsoDate?: string): boolean {
  const exp = (item.expiresAt || '').trim();
  if (!exp) return false;
  const today = nowIsoDate || new Date().toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(exp)) {
    return exp < today;
  }
  const parsed = Date.parse(exp);
  if (Number.isNaN(parsed)) return false;
  return parsed < Date.now();
}

export function applyPlaylistRules(
  items: RunnerHighlight[],
  config: HighlightsMarqueeConfig,
  nowIsoDate?: string,
): RunnerHighlight[] {
  let list = [...items];

  if (config.hideExpired) {
    list = list.filter((item) => !isHighlightExpired(item, nowIsoDate));
  }

  const filter = (config.filterRaceId || '').trim();
  if (filter === 'latest' && list.length > 0) {
    const latestRaceDate = list.reduce((best, cur) => (cur.raceDate > best ? cur.raceDate : best), '');
    const latestRaceItem = list.find((cur) => cur.raceDate === latestRaceDate);
    if (latestRaceItem?.raceId) {
      list = list.filter((item) => item.raceId === latestRaceItem.raceId);
    } else if (latestRaceDate) {
      list = list.filter((item) => item.raceDate === latestRaceDate);
    }
  } else if (filter) {
    list = list.filter((item) => item.raceId === filter || item.raceName === filter);
  }

  list.sort((a, b) => {
    const pinDiff = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
    if (pinDiff !== 0) return pinDiff;

    if (config.pinPodiumFirst) {
      const rankDiff = placementRankWeight(a.placement) - placementRankWeight(b.placement);
      if (rankDiff !== 0) return rankDiff;
    }

    const timeB = Date.parse(b.updatedAt || b.createdAt || '') || 0;
    const timeA = Date.parse(a.updatedAt || a.createdAt || '') || 0;
    return timeB - timeA;
  });

  return list;
}

export function normalizeHighlightConfig(raw: Partial<HighlightsMarqueeConfig> | undefined | null): HighlightsMarqueeConfig {
  const hoverBehavior: HighlightHoverBehavior =
    raw?.hoverBehavior === 'slow' || raw?.hoverBehavior === 'keep' || raw?.hoverBehavior === 'stop'
      ? raw.hoverBehavior
      : DEFAULT_MARQUEE_CONFIG.hoverBehavior;
  const direction: HighlightFlowDirection =
    raw?.direction === 'right' || raw?.direction === 'left'
      ? raw.direction
      : DEFAULT_MARQUEE_CONFIG.direction;
  const layoutMode: HighlightCardLayoutMode =
    raw?.layoutMode === 'pill' || raw?.layoutMode === 'card'
      ? raw.layoutMode
      : DEFAULT_MARQUEE_CONFIG.layoutMode;

  return {
    speedPxPerSec: clampNumber(Number(raw?.speedPxPerSec ?? DEFAULT_MARQUEE_CONFIG.speedPxPerSec), 10, 120),
    hoverBehavior,
    direction,
    layoutMode,
    cardGapPx: clampNumber(Number(raw?.cardGapPx ?? DEFAULT_MARQUEE_CONFIG.cardGapPx), 12, 32),
    edgeFadePx: clampNumber(Number(raw?.edgeFadePx ?? DEFAULT_MARQUEE_CONFIG.edgeFadePx), 0, 120),
    pinPodiumFirst: typeof raw?.pinPodiumFirst === 'boolean' ? raw.pinPodiumFirst : DEFAULT_MARQUEE_CONFIG.pinPodiumFirst,
    filterRaceId: typeof raw?.filterRaceId === 'string' ? raw.filterRaceId.slice(0, 80) : DEFAULT_MARQUEE_CONFIG.filterRaceId,
    hideExpired: typeof raw?.hideExpired === 'boolean' ? raw.hideExpired : DEFAULT_MARQUEE_CONFIG.hideExpired,
    updatedAt: typeof raw?.updatedAt === 'string' ? raw.updatedAt : undefined,
    updatedBy: typeof raw?.updatedBy === 'string' ? raw.updatedBy : undefined,
  };
}

export function sanitizeHighlightPayload(draft: RunnerHighlight): RunnerHighlight {
  const now = new Date().toISOString();
  const safeId = (draft.id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || `hl_${Date.now().toString(36)}`;
  const mode = draft.mode === 'duo' ? 'duo' : 'solo';

  const base: RunnerHighlight = {
    id: safeId,
    mode,
    runnerName: capText(draft.runnerName, HIGHLIGHT_CAPS.runnerName) || 'Runner',
    bibNumber: capText(draft.bibNumber, HIGHLIGHT_CAPS.bibNumber) || '001',
    placement: capText(draft.placement, HIGHLIGHT_CAPS.placement) || 'Finisher',
    distance: capText(draft.distance, HIGHLIGHT_CAPS.distance) || '10K',
    chipTime: capText(draft.chipTime, HIGHLIGHT_CAPS.chipTime) || '00:00:00',
    pace: capText(draft.pace, HIGHLIGHT_CAPS.pace) || '5:00 /km',
    raceName: capText(draft.raceName, HIGHLIGHT_CAPS.raceName) || 'RacePulsePH Event',
    raceDate: capText(draft.raceDate, HIGHLIGHT_CAPS.raceDate) || now.slice(0, 10),
    photoUrl: (draft.photoUrl || '').trim(),
    borderPreset: draft.borderPreset || 'liquid-gold',
    cornerGeometry: draft.cornerGeometry || 'rounded',
    accentColor: sanitizeHexColor(draft.accentColor, '#ff3b30'),
    glowIntensity: Math.round(clampNumber(Number(draft.glowIntensity ?? 72), 0, 100)),
    surfaceFinish: draft.surfaceFinish || 'matte',
    createdAt: draft.createdAt || now,
    updatedAt: now,
  };

  if (mode === 'duo') {
    const pName = capText(draft.partnerName, HIGHLIGHT_CAPS.runnerName);
    const pBib = capText(draft.partnerBibNumber, HIGHLIGHT_CAPS.bibNumber);
    const pPhoto = (draft.partnerPhotoUrl || '').trim();
    const sSplit = capText(draft.soloSplitTime, HIGHLIGHT_CAPS.chipTime);
    const pSplit = capText(draft.partnerSplitTime, HIGHLIGHT_CAPS.chipTime);
    const avgPace = capText(draft.combinedAvgPace, HIGHLIGHT_CAPS.pace);
    if (pName) base.partnerName = pName;
    if (pBib) base.partnerBibNumber = pBib;
    if (pPhoto) base.partnerPhotoUrl = pPhoto;
    if (sSplit) base.soloSplitTime = sSplit;
    if (pSplit) base.partnerSplitTime = pSplit;
    if (avgPace) base.combinedAvgPace = avgPace;
  }

  const gunTime = capText(draft.gunTime, HIGHLIGHT_CAPS.gunTime);
  const splitPace = capText(draft.splitPace, HIGHLIGHT_CAPS.splitPace);
  const runClub = capText(draft.runClub, HIGHLIGHT_CAPS.runClub);
  const raceId = (draft.raceId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  const raceCode = capText(draft.raceCode, HIGHLIGHT_CAPS.raceCode).toUpperCase();
  const badgeStamp = capText(draft.badgeStamp, HIGHLIGHT_CAPS.badgeStamp).toUpperCase();
  const expiresAt = capText(draft.expiresAt, 24);
  const createdBy = (draft.createdBy || '').trim().slice(0, 128);

  if (gunTime) base.gunTime = gunTime;
  if (splitPace) base.splitPace = splitPace;
  if (runClub) base.runClub = runClub;
  if (raceId) base.raceId = raceId;
  if (raceCode) base.raceCode = raceCode;
  if (badgeStamp) base.badgeStamp = badgeStamp;
  if (typeof draft.pinned === 'boolean') base.pinned = draft.pinned;
  if (expiresAt) base.expiresAt = expiresAt;
  if (createdBy) base.createdBy = createdBy;

  return base;
}

export function deriveRaceCode(raceName: string, raceDate: string): string {
  const words = raceName
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const prefix = words.slice(0, 3).map((w) => w.slice(0, 3)).join('-');
  const year = (raceDate || '').slice(0, 4);
  return `${prefix || 'RPPH'}${year ? `-${year}` : ''}`.slice(0, HIGHLIGHT_CAPS.raceCode);
}

export function formatReadableDate(dateStr: string): string {
  const parts = (dateStr || '').split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return dateStr;
  const [y, m, d] = parts;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(dt);
}

export function formatHighlightShareSummary(item: RunnerHighlight): string {
  const names = item.mode === 'duo' && item.partnerName
    ? `${item.runnerName} & ${item.partnerName}`
    : item.runnerName;
  const bibs = item.mode === 'duo' && item.partnerBibNumber
    ? `Bibs #${item.bibNumber} / #${item.partnerBibNumber}`
    : `Bib #${item.bibNumber}`;
  return `${names} (${bibs}) finished ${item.distance} at ${item.raceName} in ${item.chipTime} (${item.pace}) [${item.placement}]. Happy running ka Racepulse!`;
}

// ========== FIRESTORE SUBSCRIPTIONS & CRUD ==========

export function subscribeRunnerHighlights(
  listener: (items: RunnerHighlight[], loaded: boolean, error: string | null) => void,
): () => void {
  return onSnapshot(
    collection(db, 'runnerHighlights'),
    (snapshot) => {
      const list: RunnerHighlight[] = [];
      snapshot.forEach((snap) => {
        list.push({ ...(snap.data() as RunnerHighlight), id: snap.id });
      });
      listener(list, true, null);
    },
    (err) => {
      listener([], false, err.message || 'Could not load runner highlights.');
    },
  );
}

export function subscribeHighlightsConfig(
  listener: (config: HighlightsMarqueeConfig, loaded: boolean) => void,
): () => void {
  return onSnapshot(
    doc(db, 'system', 'highlightsConfig'),
    (snap) => {
      if (!snap.exists()) {
        listener(DEFAULT_MARQUEE_CONFIG, true);
        return;
      }
      listener(normalizeHighlightConfig(snap.data() as Partial<HighlightsMarqueeConfig>), true);
    },
    () => {
      listener(DEFAULT_MARQUEE_CONFIG, true);
    },
  );
}

export async function saveRunnerHighlight(item: RunnerHighlight): Promise<RunnerHighlight> {
  const payload = sanitizeHighlightPayload(item);
  await setDoc(doc(db, 'runnerHighlights', payload.id), payload);
  return payload;
}

export async function deleteRunnerHighlight(highlightId: string): Promise<void> {
  await deleteDoc(doc(db, 'runnerHighlights', highlightId));
}

export async function saveHighlightsMarqueeConfig(
  config: HighlightsMarqueeConfig,
  options: { actorUid: string; includePlaylistRules: boolean },
): Promise<void> {
  const normalized = normalizeHighlightConfig(config);
  const now = new Date().toISOString();
  const basePayload: Record<string, unknown> = {
    speedPxPerSec: normalized.speedPxPerSec,
    hoverBehavior: normalized.hoverBehavior,
    direction: normalized.direction,
    layoutMode: normalized.layoutMode,
    cardGapPx: normalized.cardGapPx,
    edgeFadePx: normalized.edgeFadePx,
    updatedAt: now,
    updatedBy: options.actorUid,
  };

  if (options.includePlaylistRules) {
    basePayload.pinPodiumFirst = normalized.pinPodiumFirst;
    basePayload.filterRaceId = normalized.filterRaceId;
    basePayload.hideExpired = normalized.hideExpired;
  }

  await setDoc(doc(db, 'system', 'highlightsConfig'), basePayload, { merge: true });
}

// ========== IMAGE SMART CROP & UPLOAD HELPERS ==========

export interface SmartCropSpec {
  sourceUrl: string;
  zoom: number;
  offsetX: number; // -1 to 1 normalized pan offset
  offsetY: number; // -1 to 1 normalized pan offset
  targetWidth: number;
  targetHeight: number;
  quality?: number;
}

export function loadImageElement(src: string, crossOrigin?: 'anonymous'): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin && !src.startsWith('data:') && !src.startsWith('blob:')) {
      img.crossOrigin = crossOrigin;
    }
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Unable to load image.'));
    img.src = src;
  });
}

export async function bakeSmartCropToDataUrl(spec: SmartCropSpec): Promise<string> {
  const img = await loadImageElement(spec.sourceUrl);
  const { targetWidth, targetHeight } = spec;
  const zoom = clampNumber(spec.zoom, 1, 3.5);
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable in this browser.');

  // Cover scale at zoom = 1
  const baseScale = Math.max(targetWidth / img.width, targetHeight / img.height);
  const drawScale = baseScale * zoom;
  const drawnW = img.width * drawScale;
  const drawnH = img.height * drawScale;
  const maxPanX = Math.max(0, (drawnW - targetWidth) / 2);
  const maxPanY = Math.max(0, (drawnH - targetHeight) / 2);
  const dx = (targetWidth - drawnW) / 2 + clampNumber(spec.offsetX, -1, 1) * maxPanX;
  const dy = (targetHeight - drawnH) / 2 + clampNumber(spec.offsetY, -1, 1) * maxPanY;

  ctx.fillStyle = '#0c0c0e';
  ctx.fillRect(0, 0, targetWidth, targetHeight);
  ctx.drawImage(img, dx, dy, drawnW, drawnH);

  // Compress gracefully below ~260KB so Firestore fallback also stays nimble
  let q = spec.quality ?? 0.84;
  let dataUrl = canvas.toDataURL('image/jpeg', q);
  while (dataUrl.length > 290_000 && q > 0.48) {
    q -= 0.08;
    dataUrl = canvas.toDataURL('image/jpeg', q);
  }
  return dataUrl;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(',');
  const mimeMatch = header?.match(/data:([^;]+);base64/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const binary = atob(base64 || '');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

export async function uploadHighlightAsset(
  ownerUid: string,
  highlightId: string,
  slot: 'primary' | 'partner',
  croppedDataUrl: string,
): Promise<string> {
  if (!ownerUid) return croppedDataUrl;
  try {
    const blob = dataUrlToBlob(croppedDataUrl);
    const assetRef = ref(storage, `highlight-assets/${ownerUid}/${highlightId}/${slot}-${Date.now()}.jpg`);
    await Promise.race([
      uploadBytes(assetRef, blob, { contentType: 'image/jpeg' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Storage upload timed out')), 7000)),
    ]);
    return await getDownloadURL(assetRef);
  } catch (err) {
    // Resilient fallback: the pre-cropped JPEG is already sized under 290KB so
    // Firestore stores it directly when Storage rules/network aren't available.
    console.warn('Highlight Storage upload fell back to inline JPEG:', err);
    return croppedDataUrl;
  }
}

// ========== COLLECTIBLE SOCIAL CARD PNG EXPORTER ==========

export async function exportHighlightSocialCardPng(item: RunnerHighlight): Promise<void> {
  const W = 780;
  const H = 1020;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable.');

  const accent = sanitizeHexColor(item.accentColor, '#ff3b30');

  // Outer card background
  ctx.fillStyle = '#0c0c0f';
  ctx.fillRect(0, 0, W, H);

  // Outer accent border
  ctx.strokeStyle = accent;
  ctx.lineWidth = 10;
  ctx.strokeRect(18, 18, W - 36, H - 36);

  // Inner photo frame
  const pad = 34;
  const frameW = W - pad * 2;
  const frameH = H - pad * 2;

  ctx.save();
  ctx.beginPath();
  ctx.rect(pad, pad, frameW, frameH);
  ctx.clip();

  const tryDrawCover = async (src: string, clipX: number, clipW: number) => {
    try {
      const img = await loadImageElement(src, 'anonymous');
      ctx.save();
      ctx.beginPath();
      ctx.rect(clipX, pad, clipW, frameH);
      ctx.clip();
      const scale = Math.max(clipW / img.width, frameH / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.drawImage(img, clipX + (clipW - dw) / 2, pad + (frameH - dh) / 2, dw, dh);
      ctx.restore();
    } catch {
      ctx.fillStyle = '#18181d';
      ctx.fillRect(clipX, pad, clipW, frameH);
    }
  };

  if (item.mode === 'duo' && item.partnerPhotoUrl) {
    await Promise.all([
      tryDrawCover(item.photoUrl, pad, frameW / 2),
      tryDrawCover(item.partnerPhotoUrl, pad + frameW / 2, frameW / 2),
    ]);
    // Diagonal slash line
    ctx.strokeStyle = accent;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(pad + frameW / 2 + 45, pad);
    ctx.lineTo(pad + frameW / 2 - 45, pad + frameH);
    ctx.stroke();
  } else if (item.photoUrl) {
    await tryDrawCover(item.photoUrl, pad, frameW);
  }

  // Bottom 52% dark scrim for contrast guard
  const scrim = ctx.createLinearGradient(0, pad + frameH * 0.42, 0, pad + frameH);
  scrim.addColorStop(0, 'rgba(8, 8, 11, 0)');
  scrim.addColorStop(0.45, 'rgba(8, 8, 11, 0.72)');
  scrim.addColorStop(1, 'rgba(8, 8, 11, 0.96)');
  ctx.fillStyle = scrim;
  ctx.fillRect(pad, pad, frameW, frameH);

  // Top scrim
  const topScrim = ctx.createLinearGradient(0, pad, 0, pad + 180);
  topScrim.addColorStop(0, 'rgba(8, 8, 11, 0.85)');
  topScrim.addColorStop(1, 'rgba(8, 8, 11, 0)');
  ctx.fillStyle = topScrim;
  ctx.fillRect(pad, pad, frameW, 180);

  // Header brand + placement
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 24px "Space Grotesk", Inter, sans-serif';
  ctx.fillText('RACEPULSEPH', pad + 28, pad + 56);

  ctx.fillStyle = accent;
  ctx.fillRect(pad + 28, pad + 72, 92, 5);

  // Placement badge
  const placementText = item.placement.toUpperCase();
  ctx.font = '700 22px "JetBrains Mono", monospace';
  const badgeW = Math.max(120, ctx.measureText(placementText).width + 36);
  ctx.fillStyle = accent;
  ctx.fillRect(pad + frameW - badgeW - 28, pad + 30, badgeW, 44);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.fillText(placementText, pad + frameW - badgeW / 2 - 28, pad + 60);
  ctx.textAlign = 'left';

  if (item.badgeStamp) {
    ctx.font = '700 18px "JetBrains Mono", monospace';
    ctx.fillStyle = '#fbbf24';
    ctx.fillText(item.badgeStamp.toUpperCase(), pad + 28, pad + 106);
  }

  // Bottom typography block
  const bottomY = pad + frameH - 36;
  ctx.fillStyle = '#d4d4d8';
  ctx.font = '600 22px "JetBrains Mono", monospace';
  ctx.fillText(`${item.raceName.toUpperCase()}  |  ${formatReadableDate(item.raceDate)}`, pad + 28, bottomY - 196);

  ctx.fillStyle = '#ffffff';
  ctx.font = '700 44px "Space Grotesk", Inter, sans-serif';
  const displayName = item.mode === 'duo' && item.partnerName
    ? `${item.runnerName} & ${item.partnerName}`
    : item.runnerName;
  ctx.fillText(displayName.slice(0, 34), pad + 28, bottomY - 136);

  // Metrics strip
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 2;
  ctx.strokeRect(pad + 28, bottomY - 104, frameW - 56, 86);

  const cols = [
    { label: 'DISTANCE', value: item.distance },
    { label: 'CHIP TIME', value: item.chipTime },
    { label: 'AVG PACE', value: item.mode === 'duo' && item.combinedAvgPace ? item.combinedAvgPace : item.pace },
    { label: 'BIB', value: item.mode === 'duo' && item.partnerBibNumber ? `#${item.bibNumber}/#${item.partnerBibNumber}` : `#${item.bibNumber}` },
  ];
  const colW = (frameW - 56) / cols.length;
  cols.forEach((col, i) => {
    const cx = pad + 42 + i * colW;
    ctx.fillStyle = '#a1a1aa';
    ctx.font = '600 16px "JetBrains Mono", monospace';
    ctx.fillText(col.label, cx, bottomY - 72);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 24px "JetBrains Mono", monospace';
    ctx.fillText(col.value.slice(0, 14), cx, bottomY - 36);
  });

  ctx.restore();

  const pngUrl = canvas.toDataURL('image/png');
  const link = document.createElement('a');
  const slug = item.runnerName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'runner';
  link.download = `RacePulsePH-${slug}-${item.bibNumber}.png`;
  link.href = pngUrl;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
