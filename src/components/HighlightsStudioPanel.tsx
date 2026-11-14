import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Award,
  Copy,
  Edit3,
  Eye,
  Flame,
  Layers,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Save,
  Sliders,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { useAccess } from '../lib/access';
import { subscribeSharedRaces } from '../lib/racesStore';
import {
  applyPlaylistRules,
  DEFAULT_MARQUEE_CONFIG,
  deleteRunnerHighlight,
  deriveRaceCode,
  formatReadableDate,
  HIGHLIGHT_BORDER_PRESETS,
  HIGHLIGHT_CAPS,
  HIGHLIGHT_CORNER_GEOMETRIES,
  HIGHLIGHT_DISTANCES,
  HIGHLIGHT_PLACEMENTS,
  HIGHLIGHT_SURFACE_FINISHES,
  isHighlightExpired,
  saveHighlightsMarqueeConfig,
  saveRunnerHighlight,
  subscribeHighlightsConfig,
  subscribeRunnerHighlights,
  uploadHighlightAsset,
} from '../lib/highlights';
import {
  HighlightBorderPreset,
  HighlightCardLayoutMode,
  HighlightsMarqueeConfig,
  Race,
  RunnerHighlight,
  UserProfile,
} from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { useFeedback } from './ui/FeedbackProvider';
import PodiumPulseCard from './PodiumPulseCard';
import HighlightSmartCropModal from './HighlightSmartCropModal';

type StudioSubTab = 'studio' | 'published' | 'deck';

interface HighlightsStudioPanelProps {
  profile: UserProfile;
}

const QUICK_ACCENT_SWATCHES = ['#ff3b30', '#f5b731', '#22d3ee', '#a855f7', '#10b981', '#ffffff'] as const;
const QUICK_BADGE_STAMPS = ['CHAMPION', 'NEW COURSE RECORD', 'SUB-1 HOUR', 'PODIUM FINISH'] as const;

function createBlankDraft(uid: string): RunnerHighlight {
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  return {
    id: `hl_${Date.now().toString(36)}`,
    mode: 'solo',
    runnerName: '',
    bibNumber: '',
    partnerName: '',
    partnerBibNumber: '',
    photoUrl: '',
    partnerPhotoUrl: '',
    placement: '1st',
    distance: '10K',
    chipTime: '',
    gunTime: '',
    pace: '',
    splitPace: '',
    soloSplitTime: '',
    partnerSplitTime: '',
    combinedAvgPace: '',
    raceId: '',
    raceName: '',
    raceCode: '',
    raceDate: today,
    runClub: '',
    borderPreset: 'liquid-gold',
    cornerGeometry: 'rounded',
    accentColor: '#f5b731',
    glowIntensity: 75,
    surfaceFinish: 'glossy',
    badgeStamp: '',
    pinned: false,
    expiresAt: '',
    createdBy: uid,
    createdAt: now,
    updatedAt: now,
  };
}

export default function HighlightsStudioPanel({ profile }: HighlightsStudioPanelProps) {
  const { can, authority: isSuperAdmin } = useAccess();
  const { confirm, notify } = useFeedback();

  const canManage = isSuperAdmin || can('highlights.manage');
  const canSettings = isSuperAdmin || can('highlights.settings');
  const canPlaylist = isSuperAdmin || can('highlights.playlist');

  const [subTab, setSubTab] = useState<StudioSubTab>('studio');
  const [highlights, setHighlights] = useState<RunnerHighlight[]>([]);
  const [config, setConfig] = useState<HighlightsMarqueeConfig>(DEFAULT_MARQUEE_CONFIG);
  const [races, setRaces] = useState<Race[]>([]);
  const [draft, setDraft] = useState<RunnerHighlight>(() => createBlankDraft(profile.uid));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingHighlight, setSavingHighlight] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);

  // Right preview toggles
  const [previewHover, setPreviewHover] = useState(false);
  const [previewLayout, setPreviewLayout] = useState<HighlightCardLayoutMode>('card');

  // Smart crop dialog state
  const [cropSession, setCropSession] = useState<{
    slot: 'primary' | 'partner';
    sourceUrl: string;
  } | null>(null);

  // Published manager search filter
  const [publishedSearch, setPublishedSearch] = useState('');

  const primaryFileRef = useRef<HTMLInputElement | null>(null);
  const partnerFileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const unsubH = subscribeRunnerHighlights((items) => setHighlights(items));
    const unsubC = subscribeHighlightsConfig((cfg) => setConfig(cfg));
    const unsubR = subscribeSharedRaces((list, loaded) => {
      if (loaded) setRaces(list);
    });
    return () => {
      unsubH();
      unsubC();
      unsubR();
    };
  }, []);

  const orderedHighlights = useMemo(
    () => applyPlaylistRules(highlights, { ...config, hideExpired: false, filterRaceId: '' }),
    [highlights, config],
  );

  const filteredPublished = useMemo(() => {
    const q = publishedSearch.trim().toLowerCase();
    if (!q) return orderedHighlights;
    return orderedHighlights.filter(
      (item) =>
        item.runnerName.toLowerCase().includes(q) ||
        (item.partnerName || '').toLowerCase().includes(q) ||
        item.bibNumber.toLowerCase().includes(q) ||
        item.raceName.toLowerCase().includes(q),
    );
  }, [orderedHighlights, publishedSearch]);

  const livePreviewItem = useMemo<RunnerHighlight>(() => {
    return {
      ...draft,
      runnerName: draft.runnerName || 'Runner Name',
      bibNumber: draft.bibNumber || '1042',
      partnerName: draft.mode === 'duo' ? draft.partnerName || 'Partner Name' : undefined,
      partnerBibNumber: draft.mode === 'duo' ? draft.partnerBibNumber || '1043' : undefined,
      chipTime: draft.chipTime || '00:41:18',
      pace: draft.pace || '4:08 /km',
      raceName: draft.raceName || 'RacePulsePH Classic',
      raceDate: draft.raceDate || new Date().toISOString().slice(0, 10),
    };
  }, [draft]);

  const handleSelectFile = (slot: 'primary' | 'partner', e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      notify({ title: 'Unsupported file', message: 'Select a JPG, PNG, or WebP photo.', tone: 'error' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setCropSession({ slot, sourceUrl: reader.result });
      }
    };
    reader.readAsDataURL(file);
  };

  const handleLinkedRaceChange = (raceId: string) => {
    if (!raceId) {
      setDraft((prev) => ({ ...prev, raceId: '' }));
      return;
    }
    const found = races.find((r) => r.id === raceId);
    if (!found) return;
    setDraft((prev) => ({
      ...prev,
      raceId: found.id,
      raceName: found.name.slice(0, HIGHLIGHT_CAPS.raceName),
      raceDate: found.date,
      raceCode: deriveRaceCode(found.name, found.date),
    }));
  };

  const handleSelectBorderPreset = (presetId: HighlightBorderPreset) => {
    const meta = HIGHLIGHT_BORDER_PRESETS.find((p) => p.id === presetId);
    setDraft((prev) => ({
      ...prev,
      borderPreset: presetId,
      accentColor: meta?.defaultAccent || prev.accentColor,
    }));
  };

  const handleSaveHighlight = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) return;

    if (!draft.photoUrl) {
      notify({ title: 'Photo required', message: 'Upload and crop a runner photo first.', tone: 'error' });
      return;
    }
    if (draft.mode === 'duo' && !draft.partnerPhotoUrl) {
      notify({ title: 'Second photo required', message: 'Duo highlights require both runner photos.', tone: 'error' });
      return;
    }
    if (!draft.runnerName.trim() || !draft.bibNumber.trim() || !draft.chipTime.trim() || !draft.raceName.trim()) {
      notify({ title: 'Missing details', message: 'Enter runner name, bib, chip time, and race event.', tone: 'error' });
      return;
    }
    if (draft.mode === 'duo' && !draft.partnerName?.trim()) {
      notify({ title: 'Partner name required', message: 'Enter the second runner name for Duo mode.', tone: 'error' });
      return;
    }

    setSavingHighlight(true);
    try {
      const targetId = editingId || draft.id || `hl_${Date.now().toString(36)}`;
      let finalPrimaryUrl = draft.photoUrl;
      let finalPartnerUrl = draft.partnerPhotoUrl;

      if (finalPrimaryUrl.startsWith('data:')) {
        finalPrimaryUrl = await uploadHighlightAsset(profile.uid, targetId, 'primary', finalPrimaryUrl);
      }
      if (draft.mode === 'duo' && finalPartnerUrl && finalPartnerUrl.startsWith('data:')) {
        finalPartnerUrl = await uploadHighlightAsset(profile.uid, targetId, 'partner', finalPartnerUrl);
      }

      const saved = await saveRunnerHighlight({
        ...draft,
        id: targetId,
        photoUrl: finalPrimaryUrl,
        partnerPhotoUrl: finalPartnerUrl,
        createdBy: draft.createdBy || profile.uid,
      });

      notify({
        title: editingId ? 'Highlight updated' : 'Highlight published',
        message: `${saved.runnerName} is now scheduled for the Podium Highlights reel.`,
        tone: 'success',
      });
      setEditingId(null);
      setDraft(createBlankDraft(profile.uid));
    } catch (err) {
      notify({
        title: 'Save failed',
        message: err instanceof Error ? err.message : 'Unable to save highlight.',
        tone: 'error',
      });
    } finally {
      setSavingHighlight(false);
    }
  };

  const handleEditHighlight = (item: RunnerHighlight) => {
    setEditingId(item.id);
    setDraft({ ...item });
    setSubTab('studio');
  };

  const handleDuplicateHighlight = (item: RunnerHighlight) => {
    const now = new Date().toISOString();
    setEditingId(null);
    setDraft({
      ...item,
      id: `hl_${Date.now().toString(36)}`,
      pinned: false,
      createdAt: now,
      updatedAt: now,
    });
    setSubTab('studio');
    notify({ title: 'Duplicated to studio', message: 'Update runner details and publish when ready.', tone: 'info' });
  };

  const handleTogglePin = async (item: RunnerHighlight) => {
    if (!canManage) return;
    try {
      await saveRunnerHighlight({ ...item, pinned: !item.pinned });
      notify({
        title: !item.pinned ? 'Pinned to front' : 'Unpinned highlight',
        message: item.runnerName,
        tone: 'success',
      });
    } catch {
      notify({ title: 'Pin update failed', tone: 'error' });
    }
  };

  const handleDeleteHighlight = async (item: RunnerHighlight) => {
    if (!canManage) return;
    const confirmed = await confirm({
      title: 'Remove highlight?',
      message: `Remove ${item.runnerName} (${item.raceName}) from the landing page podium reel?`,
      confirmLabel: 'Remove highlight',
      destructive: true,
    });
    if (!confirmed) return;

    try {
      await deleteRunnerHighlight(item.id);
      if (editingId === item.id) {
        setEditingId(null);
        setDraft(createBlankDraft(profile.uid));
      }
      notify({ title: 'Highlight removed', message: item.runnerName, tone: 'info' });
    } catch {
      notify({ title: 'Could not remove highlight', tone: 'error' });
    }
  };

  const handleSaveDeck = async () => {
    if (!canSettings) return;
    setSavingConfig(true);
    try {
      await saveHighlightsMarqueeConfig(config, {
        actorUid: profile.uid,
        includePlaylistRules: canPlaylist,
      });
      notify({
        title: 'Marquee controls saved',
        message: 'Landing page scroll physics and layout settings updated.',
        tone: 'success',
      });
    } catch (err) {
      notify({
        title: 'Could not save marquee settings',
        message: err instanceof Error ? err.message : 'Check access permissions.',
        tone: 'error',
      });
    } finally {
      setSavingConfig(false);
    }
  };

  const chipBtn = (active: boolean) =>
    `min-h-11 px-3 py-2 rounded-xl border text-xs font-semibold transition inline-flex items-center justify-center gap-1.5 ${
      active
        ? 'bg-red-700 text-white border-red-800 shadow-sm'
        : 'bg-[var(--surface-card)] text-[var(--text-primary)] border-[var(--border-default)] hover:bg-[var(--surface-hover)]'
    }`;

  return (
    <div className="space-y-5">
      {/* Section Header & Sub-Navigation */}
      <div className="glass-panel p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="type-section text-[var(--text-primary)] flex items-center gap-2.5">
            <Sparkles className="w-5 h-5 text-red-700 dark:text-red-400 shrink-0" aria-hidden="true" />
            <span>Podium Highlights Studio</span>
          </h1>
          <p className="text-xs sm:text-sm text-[var(--text-secondary)] mt-1">
            Publish collectible Solo &amp; Duo finisher cards and tune the landing page marquee physics.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0" role="tablist" aria-label="Highlights workspace views">
          <button
            type="button"
            role="tab"
            aria-selected={subTab === 'studio'}
            onClick={() => setSubTab('studio')}
            className={chipBtn(subTab === 'studio')}
          >
            <Layers className="w-4 h-4" aria-hidden="true" />
            <span>{editingId ? 'Edit Card' : 'Highlight Studio'}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={subTab === 'published'}
            onClick={() => setSubTab('published')}
            className={chipBtn(subTab === 'published')}
          >
            <Award className="w-4 h-4" aria-hidden="true" />
            <span>Published ({highlights.length})</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={subTab === 'deck'}
            onClick={() => setSubTab('deck')}
            className={chipBtn(subTab === 'deck')}
          >
            <Sliders className="w-4 h-4" aria-hidden="true" />
            <span>Control Deck</span>
          </button>
        </div>
      </div>

      {!canManage && !canSettings && (
        <div role="status" className="glass-inset px-4 py-3 text-sm text-[var(--text-secondary)]">
          Read-only access: ask a Super Admin to enable Manage Highlights or Marquee Control Deck in Access controls.
        </div>
      )}

      {/* TAB 1: 3-PANEL STUDIO */}
      {subTab === 'studio' && (
        <form onSubmit={handleSaveHighlight} className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
          {/* LEFT PANEL: Runner Data & Smart Crop Upload */}
          <section className="xl:col-span-4 glass-panel p-4 sm:p-5 space-y-4" aria-label="Runner data and photo upload">
            <div className="flex items-center justify-between gap-2 border-b border-[var(--border-default)] pb-2.5">
              <h2 className="font-display text-base font-semibold text-[var(--text-primary)]">
                1. Runner Data &amp; Upload
              </h2>
              <div className="inline-flex rounded-xl border border-[var(--border-default)] p-1 bg-[var(--surface-inset)]">
                {(['solo', 'duo'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    disabled={!canManage}
                    onClick={() => setDraft((prev) => ({ ...prev, mode }))}
                    className={`min-h-9 px-3 rounded-lg text-xs font-mono font-semibold uppercase transition ${
                      draft.mode === mode
                        ? 'bg-red-700 text-white'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            {/* Hidden File Inputs */}
            <input
              ref={primaryFileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleSelectFile('primary', e)}
            />
            <input
              ref={partnerFileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleSelectFile('partner', e)}
            />

            {/* Single or Duo Upload Slots */}
            <div className={`grid gap-3 ${draft.mode === 'duo' ? 'grid-cols-2' : 'grid-cols-1'}`}>
              <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 space-y-2">
                <span className="block text-xs font-mono font-semibold text-[var(--text-secondary)]">
                  {draft.mode === 'duo' ? 'Runner 1 Photo' : 'Runner Portrait'}
                </span>
                {draft.photoUrl && (
                  <img
                    src={draft.photoUrl}
                    alt="Cropped primary runner"
                    className="w-full h-28 object-cover rounded-lg border border-[var(--border-default)]"
                  />
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!canManage}
                    onClick={() => primaryFileRef.current?.click()}
                    className="h-11 px-3 text-xs flex-1"
                  >
                    <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{draft.photoUrl ? 'Replace' : 'Upload'}</span>
                  </Button>
                  {draft.photoUrl && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!canManage}
                      onClick={() => setCropSession({ slot: 'primary', sourceUrl: draft.photoUrl })}
                      className="h-11 px-3 text-xs"
                    >
                      Crop
                    </Button>
                  )}
                </div>
              </div>

              {draft.mode === 'duo' && (
                <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3 space-y-2">
                  <span className="block text-xs font-mono font-semibold text-[var(--text-secondary)]">
                    Runner 2 Photo
                  </span>
                  {draft.partnerPhotoUrl && (
                    <img
                      src={draft.partnerPhotoUrl}
                      alt="Cropped partner runner"
                      className="w-full h-28 object-cover rounded-lg border border-[var(--border-default)]"
                    />
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!canManage}
                      onClick={() => partnerFileRef.current?.click()}
                      className="h-11 px-3 text-xs flex-1"
                    >
                      <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{draft.partnerPhotoUrl ? 'Replace' : 'Upload'}</span>
                    </Button>
                    {draft.partnerPhotoUrl && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={!canManage}
                        onClick={() =>
                          setCropSession({ slot: 'partner', sourceUrl: draft.partnerPhotoUrl || '' })
                        }
                        className="h-11 px-3 text-xs"
                      >
                        Crop
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Runner Identity Fields */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div className="sm:col-span-2 space-y-1">
                <label className="text-xs font-mono text-[var(--text-secondary)]">
                  {draft.mode === 'duo' ? 'Runner 1 Name' : 'Runner Name'}
                </label>
                <Input
                  value={draft.runnerName}
                  maxLength={HIGHLIGHT_CAPS.runnerName}
                  disabled={!canManage}
                  placeholder="e.g. Marco Reyes"
                  onChange={(e) => setDraft((p) => ({ ...p, runnerName: e.target.value }))}
                  className="h-11 text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-mono text-[var(--text-secondary)]">Bib #</label>
                <Input
                  value={draft.bibNumber}
                  maxLength={HIGHLIGHT_CAPS.bibNumber}
                  disabled={!canManage}
                  placeholder="21-014"
                  onChange={(e) => setDraft((p) => ({ ...p, bibNumber: e.target.value }))}
                  className="h-11 font-mono text-sm"
                />
              </div>
            </div>

            {draft.mode === 'duo' && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div className="sm:col-span-2 space-y-1">
                  <label className="text-xs font-mono text-[var(--text-secondary)]">Runner 2 Name</label>
                  <Input
                    value={draft.partnerName || ''}
                    maxLength={HIGHLIGHT_CAPS.runnerName}
                    disabled={!canManage}
                    placeholder="e.g. Lea Santos"
                    onChange={(e) => setDraft((p) => ({ ...p, partnerName: e.target.value }))}
                    className="h-11 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-mono text-[var(--text-secondary)]">Bib #2</label>
                  <Input
                    value={draft.partnerBibNumber || ''}
                    maxLength={HIGHLIGHT_CAPS.bibNumber}
                    disabled={!canManage}
                    placeholder="21-015"
                    onChange={(e) => setDraft((p) => ({ ...p, partnerBibNumber: e.target.value }))}
                    className="h-11 font-mono text-sm"
                  />
                </div>
              </div>
            )}

            {/* Placement & Distance */}
            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <label htmlFor="hl-placement" className="text-xs font-mono text-[var(--text-secondary)]">
                  Placement
                </label>
                <select
                  id="hl-placement"
                  disabled={!canManage}
                  value={HIGHLIGHT_PLACEMENTS.includes(draft.placement as typeof HIGHLIGHT_PLACEMENTS[number]) ? draft.placement : 'custom'}
                  onChange={(e) => {
                    if (e.target.value === 'custom') {
                      setDraft((p) => ({
                        ...p,
                        placement: HIGHLIGHT_PLACEMENTS.includes(p.placement as typeof HIGHLIGHT_PLACEMENTS[number]) ? '' : p.placement,
                      }));
                    } else {
                      setDraft((p) => ({ ...p, placement: e.target.value }));
                    }
                  }}
                  className="w-full h-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] px-3 text-sm text-[var(--text-primary)]"
                >
                  {HIGHLIGHT_PLACEMENTS.map((pl) => (
                    <option key={pl} value={pl}>{pl}</option>
                  ))}
                  <option value="custom">Custom label</option>
                </select>
                {!HIGHLIGHT_PLACEMENTS.includes(draft.placement as typeof HIGHLIGHT_PLACEMENTS[number]) && (
                  <Input
                    value={draft.placement}
                    maxLength={HIGHLIGHT_CAPS.placement}
                    disabled={!canManage}
                    placeholder="e.g. Top 5 Female"
                    aria-label="Custom placement label"
                    onChange={(e) => setDraft((p) => ({ ...p, placement: e.target.value }))}
                    className="h-10 text-xs mt-1"
                  />
                )}
              </div>
              <div className="space-y-1">
                <label htmlFor="hl-distance" className="text-xs font-mono text-[var(--text-secondary)]">
                  Distance
                </label>
                <select
                  id="hl-distance"
                  disabled={!canManage}
                  value={HIGHLIGHT_DISTANCES.includes(draft.distance as typeof HIGHLIGHT_DISTANCES[number]) ? draft.distance : 'custom'}
                  onChange={(e) => {
                    if (e.target.value === 'custom') {
                      setDraft((p) => ({
                        ...p,
                        distance: HIGHLIGHT_DISTANCES.includes(p.distance as typeof HIGHLIGHT_DISTANCES[number]) ? '' : p.distance,
                      }));
                    } else {
                      setDraft((p) => ({ ...p, distance: e.target.value }));
                    }
                  }}
                  className="w-full h-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] px-3 text-sm font-mono text-[var(--text-primary)]"
                >
                  {HIGHLIGHT_DISTANCES.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                  <option value="custom">Custom distance</option>
                </select>
                {!HIGHLIGHT_DISTANCES.includes(draft.distance as typeof HIGHLIGHT_DISTANCES[number]) && (
                  <Input
                    value={draft.distance}
                    maxLength={HIGHLIGHT_CAPS.distance}
                    disabled={!canManage}
                    placeholder="e.g. 15K"
                    aria-label="Custom distance label"
                    onChange={(e) => setDraft((p) => ({ ...p, distance: e.target.value }))}
                    className="h-10 font-mono text-xs mt-1"
                  />
                )}
              </div>
            </div>

            {/* Timing Telemetry */}
            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <label className="text-xs font-mono text-[var(--text-secondary)]">Chip Time</label>
                <Input
                  value={draft.chipTime}
                  maxLength={HIGHLIGHT_CAPS.chipTime}
                  disabled={!canManage}
                  placeholder="01:24:18"
                  onChange={(e) => setDraft((p) => ({ ...p, chipTime: e.target.value }))}
                  className="h-11 font-mono text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-mono text-[var(--text-secondary)]">Pace</label>
                <Input
                  value={draft.pace}
                  maxLength={HIGHLIGHT_CAPS.pace}
                  disabled={!canManage}
                  placeholder="3:59 /km"
                  onChange={(e) => setDraft((p) => ({ ...p, pace: e.target.value }))}
                  className="h-11 font-mono text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-mono text-[var(--text-secondary)]">
                  {draft.mode === 'duo' ? 'Runner 1 Split' : 'Gun Time'}
                </label>
                <Input
                  value={draft.mode === 'duo' ? (draft.soloSplitTime || '') : (draft.gunTime || '')}
                  maxLength={HIGHLIGHT_CAPS.gunTime}
                  disabled={!canManage}
                  placeholder={draft.mode === 'duo' ? '00:41:10' : '01:24:45'}
                  onChange={(e) =>
                    setDraft((p) =>
                      draft.mode === 'duo'
                        ? { ...p, soloSplitTime: e.target.value }
                        : { ...p, gunTime: e.target.value },
                    )
                  }
                  className="h-11 font-mono text-sm"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-mono text-[var(--text-secondary)]">
                  {draft.mode === 'duo' ? 'Runner 2 Split' : 'Split Pace'}
                </label>
                <Input
                  value={draft.mode === 'duo' ? (draft.partnerSplitTime || '') : (draft.splitPace || '')}
                  maxLength={HIGHLIGHT_CAPS.splitPace}
                  disabled={!canManage}
                  placeholder={draft.mode === 'duo' ? '00:43:08' : '3:52 /km'}
                  onChange={(e) =>
                    setDraft((p) =>
                      draft.mode === 'duo'
                        ? { ...p, partnerSplitTime: e.target.value }
                        : { ...p, splitPace: e.target.value },
                    )
                  }
                  className="h-11 font-mono text-sm"
                />
              </div>
            </div>

            {draft.mode === 'duo' && (
              <div className="space-y-1">
                <label className="text-xs font-mono text-[var(--text-secondary)]">Combined Avg Pace</label>
                <Input
                  value={draft.combinedAvgPace || ''}
                  maxLength={HIGHLIGHT_CAPS.pace}
                  disabled={!canManage}
                  placeholder="4:05 /km"
                  onChange={(e) => setDraft((p) => ({ ...p, combinedAvgPace: e.target.value }))}
                  className="h-11 font-mono text-sm"
                />
              </div>
            )}

            {/* Race Event Linking & Club */}
            <div className="space-y-2 pt-1 border-t border-[var(--border-default)]">
              <div className="space-y-1">
                <label htmlFor="hl-race-link" className="text-xs font-mono text-[var(--text-secondary)]">
                  Link Existing Race (Optional)
                </label>
                <select
                  id="hl-race-link"
                  disabled={!canManage}
                  value={draft.raceId || ''}
                  onChange={(e) => handleLinkedRaceChange(e.target.value)}
                  className="w-full h-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] px-3 text-sm text-[var(--text-primary)]"
                >
                  <option value="">Custom race entry</option>
                  {races.map((race) => (
                    <option key={race.id} value={race.id}>
                      {race.name} ({race.date})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                <div className="sm:col-span-2 space-y-1">
                  <label className="text-xs font-mono text-[var(--text-secondary)]">Race Event Name</label>
                  <Input
                    value={draft.raceName}
                    maxLength={HIGHLIGHT_CAPS.raceName}
                    disabled={!canManage}
                    placeholder="Manila Dawn Half Marathon"
                    onChange={(e) => setDraft((p) => ({ ...p, raceName: e.target.value }))}
                    className="h-11 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-mono text-[var(--text-secondary)]">Date</label>
                  <Input
                    type="date"
                    value={draft.raceDate}
                    disabled={!canManage}
                    onChange={(e) => setDraft((p) => ({ ...p, raceDate: e.target.value }))}
                    className="h-11 font-mono text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div className="space-y-1">
                  <label className="text-xs font-mono text-[var(--text-secondary)]">Run Club</label>
                  <Input
                    value={draft.runClub || ''}
                    maxLength={HIGHLIGHT_CAPS.runClub}
                    disabled={!canManage}
                    placeholder="BGC Striders"
                    onChange={(e) => setDraft((p) => ({ ...p, runClub: e.target.value }))}
                    className="h-11 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-mono text-[var(--text-secondary)]">HUD Race Code</label>
                  <Input
                    value={draft.raceCode || ''}
                    maxLength={HIGHLIGHT_CAPS.raceCode}
                    disabled={!canManage}
                    placeholder="MNL-21K-26"
                    onChange={(e) => setDraft((p) => ({ ...p, raceCode: e.target.value.toUpperCase() }))}
                    className="h-11 font-mono text-sm uppercase"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* CENTER PANEL: Visual FX Customizer */}
          <section className="xl:col-span-4 glass-panel p-4 sm:p-5 space-y-4" aria-label="Visual FX customizer">
            <h2 className="font-display text-base font-semibold text-[var(--text-primary)] border-b border-[var(--border-default)] pb-2.5">
              2. Visual FX Customizer
            </h2>

            {/* Frame Presets */}
            <div className="space-y-2">
              <span className="block text-xs font-mono font-semibold text-[var(--text-secondary)]">
                Border &amp; Frame FX Preset
              </span>
              <div className="grid grid-cols-1 gap-2">
                {HIGHLIGHT_BORDER_PRESETS.map((preset) => {
                  const selected = draft.borderPreset === preset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      disabled={!canManage}
                      onClick={() => handleSelectBorderPreset(preset.id)}
                      className={`min-h-11 w-full text-left px-3.5 py-2.5 rounded-xl border transition ${
                        selected
                          ? 'border-red-600 bg-red-500/10 text-[var(--text-primary)]'
                          : 'border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-[var(--text-primary)]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold">{preset.label}</span>
                        <span
                          className="w-3.5 h-3.5 rounded-full border border-white/40 shrink-0"
                          style={{ backgroundColor: preset.defaultAccent }}
                          aria-hidden="true"
                        />
                      </div>
                      <p className="text-xs text-[var(--text-secondary)] mt-0.5">{preset.summary}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Corner Geometry */}
            <div className="space-y-2">
              <span className="block text-xs font-mono font-semibold text-[var(--text-secondary)]">
                Corner Geometry
              </span>
              <div className="grid grid-cols-3 gap-2">
                {HIGHLIGHT_CORNER_GEOMETRIES.map((geo) => (
                  <button
                    key={geo.id}
                    type="button"
                    disabled={!canManage}
                    onClick={() => setDraft((p) => ({ ...p, cornerGeometry: geo.id }))}
                    className={chipBtn(draft.cornerGeometry === geo.id)}
                  >
                    {geo.label.split(' ')[0]}
                  </button>
                ))}
              </div>
            </div>

            {/* Accent Color & Glow Intensity */}
            <div className="space-y-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3.5">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="hl-accent-hex" className="text-xs font-mono font-semibold text-[var(--text-primary)]">
                  Accent &amp; Aura Color
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="hl-accent-picker"
                    type="color"
                    disabled={!canManage}
                    aria-label="Pick accent color"
                    value={draft.accentColor}
                    onChange={(e) => setDraft((p) => ({ ...p, accentColor: e.target.value }))}
                    className="w-9 h-9 rounded-lg border border-[var(--border-default)] bg-transparent cursor-pointer"
                  />
                  <Input
                    id="hl-accent-hex"
                    value={draft.accentColor}
                    disabled={!canManage}
                    maxLength={7}
                    onChange={(e) => setDraft((p) => ({ ...p, accentColor: e.target.value }))}
                    className="w-24 h-9 font-mono text-xs uppercase"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {QUICK_ACCENT_SWATCHES.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    disabled={!canManage}
                    aria-label={`Select accent ${hex}`}
                    onClick={() => setDraft((p) => ({ ...p, accentColor: hex }))}
                    className={`w-8 h-8 rounded-full border-2 transition ${
                      draft.accentColor.toLowerCase() === hex ? 'border-white scale-110 ring-2 ring-red-600' : 'border-black/30'
                    }`}
                    style={{ backgroundColor: hex }}
                  />
                ))}
              </div>

              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-[var(--text-secondary)]">Glow Intensity</span>
                  <span className="font-semibold text-[var(--text-primary)]">{draft.glowIntensity}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  disabled={!canManage}
                  aria-label="Glow intensity"
                  value={draft.glowIntensity}
                  onChange={(e) => setDraft((p) => ({ ...p, glowIntensity: Number(e.target.value) }))}
                  className="w-full accent-red-600 cursor-pointer"
                />
              </div>
            </div>

            {/* Surface Finish */}
            <div className="space-y-2">
              <span className="block text-xs font-mono font-semibold text-[var(--text-secondary)]">
                Surface Finish
              </span>
              <div className="grid grid-cols-3 gap-2">
                {HIGHLIGHT_SURFACE_FINISHES.map((finish) => (
                  <button
                    key={finish.id}
                    type="button"
                    disabled={!canManage}
                    onClick={() => setDraft((p) => ({ ...p, surfaceFinish: finish.id }))}
                    className={chipBtn(draft.surfaceFinish === finish.id)}
                  >
                    {finish.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom Badge Stamp */}
            <div className="space-y-2">
              <label htmlFor="hl-stamp" className="block text-xs font-mono font-semibold text-[var(--text-secondary)]">
                Custom Badge Stamp (Optional)
              </label>
              <Input
                id="hl-stamp"
                value={draft.badgeStamp || ''}
                maxLength={HIGHLIGHT_CAPS.badgeStamp}
                disabled={!canManage}
                placeholder="e.g. NEW COURSE RECORD"
                onChange={(e) => setDraft((p) => ({ ...p, badgeStamp: e.target.value }))}
                className="h-11 font-mono text-xs uppercase"
              />
              <div className="flex flex-wrap gap-1.5">
                {QUICK_BADGE_STAMPS.map((stamp) => (
                  <button
                    key={stamp}
                    type="button"
                    disabled={!canManage}
                    onClick={() => setDraft((p) => ({ ...p, badgeStamp: stamp }))}
                    className="min-h-8 px-2.5 py-1 rounded-lg border border-[var(--border-default)] bg-[var(--surface-inset)] hover:bg-[var(--surface-hover)] text-[11px] font-mono text-[var(--text-primary)]"
                  >
                    {stamp}
                  </button>
                ))}
                {draft.badgeStamp && (
                  <button
                    type="button"
                    disabled={!canManage}
                    onClick={() => setDraft((p) => ({ ...p, badgeStamp: '' }))}
                    className="min-h-8 px-2.5 py-1 rounded-lg border border-[var(--border-default)] text-[11px] font-mono text-red-700 dark:text-red-400"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          </section>

          {/* RIGHT PANEL: Interactive Live Preview & Scheduling */}
          <section className="xl:col-span-4 glass-panel p-4 sm:p-5 space-y-4" aria-label="Interactive live preview">
            <div className="flex items-center justify-between gap-2 border-b border-[var(--border-default)] pb-2.5">
              <h2 className="font-display text-base font-semibold text-[var(--text-primary)]">
                3. Live Preview
              </h2>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setPreviewHover((v) => !v)}
                  className={chipBtn(previewHover)}
                >
                  <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{previewHover ? 'Spotlight' : 'Cruise'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewLayout((m) => (m === 'card' ? 'pill' : 'card'))}
                  className={chipBtn(previewLayout === 'pill')}
                >
                  <span>{previewLayout === 'pill' ? 'Pill' : 'Card'}</span>
                </button>
              </div>
            </div>

            {/* Preview Stage */}
            <div className="rounded-2xl border border-[var(--border-default)] bg-zinc-950/95 p-4 flex items-center justify-center overflow-x-auto min-h-[388px]">
              <PodiumPulseCard
                highlight={livePreviewItem}
                layoutMode={previewLayout}
                isSpotlight={previewHover}
              />
            </div>

            {/* Pin & Expiration Schedule */}
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3.5 space-y-3">
              <label className="flex items-center justify-between gap-3 cursor-pointer min-h-10">
                <span className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-2">
                  <Flame className="w-4 h-4 text-red-700 dark:text-red-400" aria-hidden="true" />
                  <span>Pin highlight to front of reel</span>
                </span>
                <input
                  type="checkbox"
                  disabled={!canManage}
                  checked={Boolean(draft.pinned)}
                  onChange={(e) => setDraft((p) => ({ ...p, pinned: e.target.checked }))}
                  className="w-5 h-5 accent-red-600 rounded"
                />
              </label>

              <div className="flex items-center justify-between gap-3">
                <label htmlFor="hl-expires" className="text-xs font-mono text-[var(--text-secondary)]">
                  Auto-expire after
                </label>
                <Input
                  id="hl-expires"
                  type="date"
                  disabled={!canManage}
                  value={draft.expiresAt || ''}
                  onChange={(e) => setDraft((p) => ({ ...p, expiresAt: e.target.value }))}
                  className="w-44 h-10 font-mono text-xs"
                />
              </div>
            </div>

            {/* Publish / Reset Buttons */}
            <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
              <Button type="submit" disabled={!canManage || savingHighlight} className="h-11 px-4 flex-1 text-xs">
                {editingId ? <Save className="w-4 h-4" aria-hidden="true" /> : <Plus className="w-4 h-4" aria-hidden="true" />}
                <span>
                  {savingHighlight
                    ? 'Saving...'
                    : editingId
                      ? 'Save Highlight Changes'
                      : 'Publish Highlight'}
                </span>
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={savingHighlight}
                onClick={() => {
                  setEditingId(null);
                  setDraft(createBlankDraft(profile.uid));
                }}
                className="h-11 px-4 text-xs"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{editingId ? 'Cancel edit' : 'Reset'}</span>
              </Button>
            </div>
          </section>
        </form>
      )}

      {/* TAB 2: PUBLISHED HIGHLIGHTS MANAGER */}
      {subTab === 'published' && (
        <section className="glass-panel p-4 sm:p-5 space-y-4" aria-label="Published highlights manager">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h2 className="font-display text-lg font-semibold text-[var(--text-primary)]">
              Published Podium Cards
            </h2>
            <Input
              type="search"
              aria-label="Filter published highlights"
              placeholder="Search runner, bib, or race"
              value={publishedSearch}
              onChange={(e) => setPublishedSearch(e.target.value)}
              className="w-full sm:w-72 h-11 text-sm"
            />
          </div>

          {filteredPublished.length === 0 ? (
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-6 text-center space-y-3">
              <p className="text-sm text-[var(--text-secondary)]">
                {highlights.length === 0
                  ? 'No highlights published yet. Use Highlight Studio to create your first collectible podium card.'
                  : 'No highlights match your current search filter.'}
              </p>
              {highlights.length === 0 && canManage && (
                <Button type="button" onClick={() => setSubTab('studio')} className="h-11 px-4 text-xs">
                  <Plus className="w-4 h-4" aria-hidden="true" />
                  <span>Create first highlight</span>
                </Button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {filteredPublished.map((item) => {
                const expired = isHighlightExpired(item);
                const name =
                  item.mode === 'duo' && item.partnerName
                    ? `${item.runnerName} & ${item.partnerName}`
                    : item.runnerName;

                return (
                  <div
                    key={item.id}
                    className="rounded-2xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3.5 flex flex-col justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <img
                        src={item.photoUrl}
                        alt={item.runnerName}
                        className="w-16 h-20 rounded-xl object-cover border border-[var(--border-default)] shrink-0 bg-zinc-900"
                      />
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
                          <span className="px-2 py-0.5 rounded bg-red-700 text-white font-semibold">
                            {item.placement}
                          </span>
                          <span className="px-2 py-0.5 rounded border border-[var(--border-default)] text-[var(--text-secondary)]">
                            {item.mode.toUpperCase()} {item.distance}
                          </span>
                          {item.pinned && (
                            <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-700 dark:text-amber-300 font-semibold">
                              PINNED
                            </span>
                          )}
                          {expired && (
                            <span className="px-2 py-0.5 rounded bg-zinc-500/20 text-zinc-600 dark:text-zinc-300">
                              EXPIRED
                            </span>
                          )}
                        </div>
                        <p className="font-display font-semibold text-sm text-[var(--text-primary)] truncate">
                          {name}
                        </p>
                        <p className="text-xs font-mono text-[var(--text-secondary)] truncate">
                          {item.raceName} &bull; {item.chipTime} &bull; #{item.bibNumber}
                        </p>
                        <p className="text-[11px] font-mono text-[var(--text-secondary)] truncate">
                          {formatReadableDate(item.raceDate)} &bull; {item.borderPreset}
                        </p>
                      </div>
                    </div>

                    {canManage && (
                      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[var(--border-default)]">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => handleEditHighlight(item)}
                          className="h-10 px-3 text-xs"
                        >
                          <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Edit</span>
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => handleDuplicateHighlight(item)}
                          className="h-10 px-3 text-xs"
                        >
                          <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Duplicate</span>
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => handleTogglePin(item)}
                          className="h-10 px-3 text-xs"
                        >
                          {item.pinned ? (
                            <PinOff className="w-3.5 h-3.5" aria-hidden="true" />
                          ) : (
                            <Pin className="w-3.5 h-3.5" aria-hidden="true" />
                          )}
                          <span>{item.pinned ? 'Unpin' : 'Pin'}</span>
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => handleDeleteHighlight(item)}
                          className="h-10 px-3 text-xs text-red-700 dark:text-red-400 sm:ml-auto"
                        >
                          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Delete</span>
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* TAB 3: GLOBAL MARQUEE CONTROL DECK */}
      {subTab === 'deck' && (
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-5" aria-label="Global marquee control deck">
          {/* Physics, Speed & Layout Controls */}
          <div className="lg:col-span-7 glass-panel p-4 sm:p-5 space-y-5">
            <h2 className="font-display text-lg font-semibold text-[var(--text-primary)] border-b border-[var(--border-default)] pb-2.5">
              Velocity, Direction &amp; Geometry Controls
            </h2>

            {/* Cruise Velocity Slider */}
            <div className="space-y-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-4">
              <div className="flex items-center justify-between text-sm">
                <label htmlFor="deck-speed" className="font-semibold text-[var(--text-primary)]">
                  Cruise Velocity
                </label>
                <span className="font-mono text-sm font-semibold text-red-700 dark:text-red-400">
                  {config.speedPxPerSec} px/sec
                </span>
              </div>
              <input
                id="deck-speed"
                type="range"
                min={10}
                max={120}
                step={2}
                disabled={!canSettings}
                value={config.speedPxPerSec}
                onChange={(e) => setConfig((c) => ({ ...c, speedPxPerSec: Number(e.target.value) }))}
                className="w-full accent-red-600 cursor-pointer"
              />
              <div className="flex justify-between text-[11px] font-mono text-[var(--text-secondary)]">
                <span>10 px/s (Calm gallery)</span>
                <span>60 px/s (Broadcast)</span>
                <span>120 px/s (Sprint)</span>
              </div>
            </div>

            {/* Hover Behavior */}
            <div className="space-y-2">
              <span className="block text-xs font-mono font-semibold text-[var(--text-secondary)]">
                Card Hover Behavior
              </span>
              <div className="grid grid-cols-3 gap-2.5">
                {([
                  { id: 'stop', label: 'Full Stop (0%)' },
                  { id: 'slow', label: 'Slow-Mo (20%)' },
                  { id: 'keep', label: 'Keep Moving' },
                ] as const).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={!canSettings}
                    onClick={() => setConfig((c) => ({ ...c, hoverBehavior: opt.id }))}
                    className={chipBtn(config.hoverBehavior === opt.id)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Direction & Global Layout */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <span className="block text-xs font-mono font-semibold text-[var(--text-secondary)]">
                  Flow Direction
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={!canSettings}
                    onClick={() => setConfig((c) => ({ ...c, direction: 'left' }))}
                    className={chipBtn(config.direction === 'left')}
                  >
                    Left
                  </button>
                  <button
                    type="button"
                    disabled={!canSettings}
                    onClick={() => setConfig((c) => ({ ...c, direction: 'right' }))}
                    className={chipBtn(config.direction === 'right')}
                  >
                    Right
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <span className="block text-xs font-mono font-semibold text-[var(--text-secondary)]">
                  Global Card Layout
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={!canSettings}
                    onClick={() => setConfig((c) => ({ ...c, layoutMode: 'card' }))}
                    className={chipBtn(config.layoutMode === 'card')}
                  >
                    Card (260x340)
                  </button>
                  <button
                    type="button"
                    disabled={!canSettings}
                    onClick={() => setConfig((c) => ({ ...c, layoutMode: 'pill' }))}
                    className={chipBtn(config.layoutMode === 'pill')}
                  >
                    Pill (360x140)
                  </button>
                </div>
              </div>
            </div>

            {/* Gap & Edge Fade Sliders */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3.5">
                <div className="flex items-center justify-between text-xs font-mono">
                  <label htmlFor="deck-gap" className="text-[var(--text-secondary)]">Card Gap</label>
                  <span className="font-semibold text-[var(--text-primary)]">{config.cardGapPx}px</span>
                </div>
                <input
                  id="deck-gap"
                  type="range"
                  min={12}
                  max={32}
                  step={4}
                  disabled={!canSettings}
                  value={config.cardGapPx}
                  onChange={(e) => setConfig((c) => ({ ...c, cardGapPx: Number(e.target.value) }))}
                  className="w-full accent-red-600 cursor-pointer"
                />
              </div>

              <div className="space-y-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3.5">
                <div className="flex items-center justify-between text-xs font-mono">
                  <label htmlFor="deck-fade" className="text-[var(--text-secondary)]">Edge Fade Mask</label>
                  <span className="font-semibold text-[var(--text-primary)]">{config.edgeFadePx}px</span>
                </div>
                <input
                  id="deck-fade"
                  type="range"
                  min={0}
                  max={120}
                  step={8}
                  disabled={!canSettings}
                  value={config.edgeFadePx}
                  onChange={(e) => setConfig((c) => ({ ...c, edgeFadePx: Number(e.target.value) }))}
                  className="w-full accent-red-600 cursor-pointer"
                />
              </div>
            </div>
          </div>

          {/* Smart Playlist Rules (Superadmin / highlights.playlist) */}
          <div className="lg:col-span-5 glass-panel p-4 sm:p-5 flex flex-col justify-between gap-5">
            <div className="space-y-4">
              <div className="border-b border-[var(--border-default)] pb-2.5">
                <h2 className="font-display text-lg font-semibold text-[var(--text-primary)]">
                  Smart Playlist Rules
                </h2>
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                  {canPlaylist
                    ? 'Control podium prioritization, event filtering, and expiration rules.'
                    : 'Managed by Super Admin or accounts granted Smart Playlist Rules permission.'}
                </p>
              </div>

              <label className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3.5 cursor-pointer">
                <div className="min-w-0">
                  <span className="block text-sm font-semibold text-[var(--text-primary)]">
                    Pin top podium finishers first
                  </span>
                  <span className="block text-xs text-[var(--text-secondary)]">
                    Always place Record Holders, 1st, 2nd, and 3rd ahead of general highlights.
                  </span>
                </div>
                <input
                  type="checkbox"
                  disabled={!canPlaylist}
                  checked={config.pinPodiumFirst}
                  onChange={(e) => setConfig((c) => ({ ...c, pinPodiumFirst: e.target.checked }))}
                  className="w-5 h-5 accent-red-600 shrink-0"
                />
              </label>

              <label className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] p-3.5 cursor-pointer">
                <div className="min-w-0">
                  <span className="block text-sm font-semibold text-[var(--text-primary)]">
                    Auto-hide expired highlights
                  </span>
                  <span className="block text-xs text-[var(--text-secondary)]">
                    Automatically pull highlights once their scheduled expiration date passes.
                  </span>
                </div>
                <input
                  type="checkbox"
                  disabled={!canPlaylist}
                  checked={config.hideExpired}
                  onChange={(e) => setConfig((c) => ({ ...c, hideExpired: e.target.checked }))}
                  className="w-5 h-5 accent-red-600 shrink-0"
                />
              </label>

              <div className="space-y-1.5">
                <label htmlFor="playlist-race-filter" className="block text-xs font-mono font-semibold text-[var(--text-secondary)]">
                  Filter Public Reel by Event
                </label>
                <select
                  id="playlist-race-filter"
                  disabled={!canPlaylist}
                  value={config.filterRaceId}
                  onChange={(e) => setConfig((c) => ({ ...c, filterRaceId: e.target.value }))}
                  className="w-full h-11 rounded-xl border border-[var(--border-default)] bg-[var(--surface-inset)] px-3 text-sm text-[var(--text-primary)]"
                >
                  <option value="">All published races</option>
                  <option value="latest">Latest race event only</option>
                  {races.map((race) => (
                    <option key={race.id} value={race.id}>
                      {race.name} ({race.date})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="pt-3 border-t border-[var(--border-default)] flex justify-end">
              <Button
                type="button"
                disabled={!canSettings || savingConfig}
                onClick={handleSaveDeck}
                className="h-11 px-5 text-xs w-full sm:w-auto"
              >
                <Save className="w-4 h-4" aria-hidden="true" />
                <span>{savingConfig ? 'Saving settings...' : 'Save Marquee Controls'}</span>
              </Button>
            </div>
          </div>
        </section>
      )}

      {cropSession && (
        <HighlightSmartCropModal
          sourceUrl={cropSession.sourceUrl}
          label={cropSession.slot === 'partner' ? 'Runner 2 photo' : 'Runner 1 photo'}
          aspectRatio={draft.mode === 'duo' ? 0.48 : 260 / 340}
          targetWidth={draft.mode === 'duo' ? 320 : 520}
          targetHeight={680}
          onCancel={() => setCropSession(null)}
          onConfirm={(croppedUrl) => {
            setDraft((prev) =>
              cropSession.slot === 'partner'
                ? { ...prev, partnerPhotoUrl: croppedUrl }
                : { ...prev, photoUrl: croppedUrl },
            );
            setCropSession(null);
          }}
        />
      )}
    </div>
  );
}
