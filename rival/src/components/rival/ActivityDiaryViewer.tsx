import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, Image } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { confirmAction, notify } from '../../lib/notify';
import { formatDurationClock } from '../../lib/format';
import { RivalColors, RivalRadius, RivalSerifFamily } from '../../constants/rivalTheme';
import { RivalIcon, activityIconName } from './RivalIcon';
import { CoverImage } from './CoverImage';

// Full-screen, tap-through "diary" viewer for a single activity — the photo
// dominates (70% of the screen), stats overlay its bottom edge, and a
// scrollable footer below carries an editable name/location/companions and
// a free-length journal entry (backed by activities.notes). Ported 1:1 from
// the Activity Journal mockup iterated in Claude — see that file's CSS for
// the exact px/color values this mirrors.
export type DiaryActivity = {
  id: string;
  name: string | null;
  activity_type: string;
  started_at: string;
  duration_seconds: number;
  distance_meters: number;
  elevation_meters: number | null;
  effort_score: number;
  photo_url: string | null;
  photo_focal_x: number | null;
  photo_focal_y: number | null;
  notes: string | null;
  location: string | null;
  companions: string | null;
  pinned: boolean;
  race_id: string | null;
  isPb: boolean;
};

function formatViewerDate(dateStr: string): string {
  const d = new Date(dateStr);
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
  const month = d.toLocaleDateString('en-US', { month: 'short' });
  return `${weekday}, ${month} ${d.getDate()}`;
}

// Same rule as my-activities.tsx's own METERS_SPORTS — Swim/Rowing read in
// meters (100m/1500m splits, not fractional km), everything else in km.
const METERS_SPORTS = new Set(['Swim', 'Rowing']);
function formatDistance(meters: number, activityType?: string): string | null {
  if (!meters || meters < 100) return null;
  if (activityType && METERS_SPORTS.has(activityType)) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function dayKey(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// Same trick RivalProgressBar uses for its gradient fill: web can express a
// real CSS linear-gradient via backgroundImage on a plain View (react-
// native-web passes it straight through to the DOM node); native has no
// equivalent without adding expo-linear-gradient, so it falls back to a
// flat color. Acceptable — this app runs primarily on web (see AGENTS.md).
function scrimStyle(direction: 'toTop' | 'toBottom', strength = 0.45): any {
  if (Platform.OS === 'web') {
    const angle = direction === 'toTop' ? '0deg' : '180deg';
    return { backgroundImage: `linear-gradient(${angle}, rgba(0,0,0,0) 0%, rgba(0,0,0,${strength}) 100%)` };
  }
  return { backgroundColor: `rgba(0,0,0,${strength * 0.6})` };
}

export function ActivityDiaryViewer({
  activities,
  startIndex,
  onClose,
  onUpdate,
  onUploadPhoto,
}: {
  activities: DiaryActivity[];
  startIndex: number;
  onClose: () => void;
  onUpdate: (id: string, patch: Partial<DiaryActivity>) => void;
  // Reuses the same upload flow the old card grid exposed via a camera icon —
  // without this, activities without a photo would have no way to get one
  // attached from this screen at all.
  onUploadPhoto?: (activityId: string) => void;
}) {
  const [index, setIndex] = useState(startIndex);
  const activity = activities[index];
  const insets = useSafeAreaInsets();

  // Drag-down-to-dismiss, like a native modal sheet — only claimed from the
  // handle bar (not the whole photo/scroll area), so it doesn't fight the
  // left/right tap-to-advance zones or the footer's TextInputs.
  const dragY = useRef(new Animated.Value(0)).current;
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 4,
      onPanResponderMove: (_e, g) => { if (g.dy > 0) dragY.setValue(g.dy); },
      onPanResponderRelease: (_e, g) => {
        if (g.dy > 110 || g.vy > 0.7) {
          Animated.timing(dragY, { toValue: 900, duration: 200, useNativeDriver: true }).start(() => onClose());
        } else {
          Animated.spring(dragY, { toValue: 0, useNativeDriver: true, friction: 8, tension: 60 }).start();
        }
      },
    })
  ).current;

  // Local editable copies, written to Supabase only when "Save Changes" is
  // tapped (not autosaved per-keystroke) — an explicit Save/Discard pair
  // replaced the earlier autosave-on-every-keystroke behavior, which read as
  // ambiguous with no visible confirmation that an edit had actually landed.
  const [name, setName] = useState(activity?.name || '');
  const [location, setLocation] = useState(activity?.location || '');
  const [companions, setCompanions] = useState(activity?.companions || '');
  const [notes, setNotes] = useState(activity?.notes || '');
  const [dirty, setDirty] = useState(false);
  // Web <textarea>s don't auto-grow with content by default — without this,
  // the journal box got its own internal scrollbar once text overflowed its
  // fixed height instead of the whole page just scrolling further, which is
  // what everywhere else in this viewer does.
  const [journalHeight, setJournalHeight] = useState(22);
  const [saving, setSaving] = useState(false);
  // onContentSizeChange (used for the auto-grow-while-typing case below)
  // only fires from actual user input on web — it does NOT refire just
  // because the `value` prop changed programmatically. Switching to an
  // activity with pre-existing long notes was leaving journalHeight stuck
  // at the reset value, clipping the text instead of growing to fit it.
  // Measuring the real DOM node's scrollHeight after the value lands sidesteps
  // that entirely (scrollHeight reflects the full content regardless of the
  // element's own clipped/visible height).
  const journalRef = useRef<TextInput>(null);

  useEffect(() => {
    setName(activity?.name || '');
    setLocation(activity?.location || '');
    setCompanions(activity?.companions || '');
    setNotes(activity?.notes || '');
    setDirty(false);
    setJournalHeight(22);
    if (Platform.OS === 'web') {
      requestAnimationFrame(() => {
        const node = journalRef.current as unknown as { scrollHeight?: number } | null;
        if (node && typeof node.scrollHeight === 'number') {
          setJournalHeight(Math.max(22, node.scrollHeight));
        }
      });
    }
  }, [activity?.id]);

  function edit(field: 'name' | 'location' | 'companions' | 'notes', value: string) {
    if (field === 'name') setName(value);
    else if (field === 'location') setLocation(value);
    else if (field === 'companions') setCompanions(value);
    else setNotes(value);
    setDirty(true);
  }

  async function saveChanges() {
    if (!activity || saving) return;
    setSaving(true);
    const patch: Record<string, unknown> = {
      name: name.trim() || null,
      location: location.trim() || null,
      companions: companions.trim() || null,
      notes: notes.trim() || null,
    };
    if (name.trim()) patch.name_locked = true;
    const { error } = await supabase.from('activities').update(patch).eq('id', activity.id);
    setSaving(false);
    if (error) return;
    onUpdate(activity.id, patch as Partial<DiaryActivity>);
    setDirty(false);
  }

  function discardChanges() {
    setName(activity?.name || '');
    setLocation(activity?.location || '');
    setCompanions(activity?.companions || '');
    setNotes(activity?.notes || '');
    setDirty(false);
  }

  // The X still just closes — but with unsaved edits sitting in local state
  // that close would silently drop them, so confirm first rather than
  // requiring Save before you're allowed to leave.
  async function handleClose() {
    if (dirty && !(await confirmAction({ title: 'Discard unsaved changes?', confirmLabel: 'Discard', destructive: true }))) return;
    onClose();
  }

  async function togglePin() {
    if (!activity) return;
    const next = !activity.pinned;
    onUpdate(activity.id, { pinned: next });
    const { error } = await supabase.from('activities').update({ pinned: next }).eq('id', activity.id);
    if (error) {
      onUpdate(activity.id, { pinned: !next });   // put it back
      notify("Couldn't pin that activity", error.message);
    }
  }

  function advance(dir: 1 | -1) {
    const next = index + dir;
    if (next < 0) return;
    if (next >= activities.length) { onClose(); return; }
    setIndex(next);
  }

  const dayActivities = useMemo(() => {
    if (!activity) return [];
    const key = dayKey(activity.started_at);
    return activities.filter((a) => dayKey(a.started_at) === key);
  }, [activities, activity?.started_at]);
  const dayPosition = activity ? dayActivities.findIndex((a) => a.id === activity.id) + 1 : 0;

  if (!activity) return null;

  const badgeKind: 'pb' | 'race' | null = activity.isPb ? 'pb' : activity.race_id ? 'race' : null;
  const ringColor = badgeKind === 'pb' ? RivalColors.rankAnchors.unrivaled : badgeKind === 'race' ? '#ff5c5c' : 'transparent';
  const distance = formatDistance(activity.distance_meters, activity.activity_type);
  const duration = activity.duration_seconds > 0 ? formatDurationClock(activity.duration_seconds) : null;
  const elevation = (activity.elevation_meters || 0) > 0 ? `↑ ${Math.round(activity.elevation_meters!)} m` : null;

  return (
    <Animated.View style={[styles.overlay, { transform: [{ translateY: dragY }] }]}>
      <View style={styles.dragHandleArea} {...panResponder.panHandlers}>
        <View style={styles.dragHandle} />
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.photoArea}>
          {activity.photo_url ? (
            <CoverImage
              uri={activity.photo_url}
              focalX={activity.photo_focal_x}
              focalY={activity.photo_focal_y}
              style={styles.photo}
            />
          ) : (
            <TouchableOpacity
              style={styles.photoFallback}
              activeOpacity={0.85}
              disabled={!onUploadPhoto}
              onPress={() => onUploadPhoto?.(activity.id)}
            >
              <View style={styles.addPhotoCircle}>
                <RivalIcon name="addPhoto" size={26} color={RivalColors.accentText} />
              </View>
              <Text style={styles.addPhotoLabel}>Add Photo</Text>
              <Text style={styles.addPhotoSub}>Activities with photos get seen and remembered</Text>
            </TouchableOpacity>
          )}

          {/* Top scrim + header — date left, pin/counter/close right. */}
          <View style={[styles.headerScrim, { height: 90 + insets.top }, scrimStyle('toTop')]} pointerEvents="none" />
          <View style={[styles.header, { top: insets.top + 12 }]}>
            <View>
              <Text style={styles.headerDate}>{formatViewerDate(activity.started_at)}</Text>
              {dirty && <Text style={styles.saveStatusText}>Unsaved changes</Text>}
            </View>
            <View style={styles.headerRight}>
              <TouchableOpacity style={styles.pinCorner} onPress={() => router.push(`/manual-entry?editId=${activity.id}`)}>
                <RivalIcon name="edit" size={14} color={RivalColors.accentText} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.pinCorner} onPress={togglePin}>
                <RivalIcon name={activity.pinned ? 'star' : 'starOutline'} size={15} color={RivalColors.accentText} />
              </TouchableOpacity>
              <View style={styles.counter}>
                <Text style={styles.counterText}>{dayPosition} of {dayActivities.length}</Text>
              </View>
              <TouchableOpacity style={styles.closeBtn} onPress={handleClose}>
                <RivalIcon name="close" size={14} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Bottom scrim + overlaid stats — 3 chips left, effort pill right. */}
          <View style={[styles.photoBottomScrim, scrimStyle('toBottom')]} pointerEvents="none" />
          <View style={styles.photoStats}>
            <View style={styles.photoChips}>
              {duration && <View style={styles.photoChip}><Text style={styles.photoChipText}>{duration}</Text></View>}
              {distance && <View style={styles.photoChip}><Text style={styles.photoChipText}>{distance}</Text></View>}
              {elevation && <View style={styles.photoChip}><Text style={styles.photoChipText}>{elevation}</Text></View>}
            </View>
            <View style={styles.photoEffort}>
              <Text style={styles.photoEffortNum}>{activity.effort_score}</Text>
              <Text style={styles.photoEffortUnit}>Effort</Text>
            </View>
          </View>

          {/* Tap zones over the photo — left/right advance through the
              continuous activity order, matching the row's own ordering. */}
          <TouchableOpacity style={[styles.tapArea, styles.tapAreaLeft]} activeOpacity={1} onPress={() => advance(-1)} />
          <TouchableOpacity style={[styles.tapArea, styles.tapAreaRight]} activeOpacity={1} onPress={() => advance(1)} />
        </View>

        <View style={styles.footer}>
          <Text style={styles.typeKicker}>{activity.activity_type}</Text>
          <TextInput
            style={styles.nameInput}
            value={name}
            onChangeText={(v) => edit('name', v)}
            placeholder="Name this activity…"
            placeholderTextColor="rgba(255,255,255,0.3)"
          />
          {/* Same fade-at-the-tips underline treatment as the Month calendar's
              title, just tinted the journal card's cream/brown instead of the
              orange accent. */}
          <View style={styles.nameUnderline} />
          <View style={styles.locationRow}>
            <RivalIcon name="location" size={12} color="rgba(255,255,255,0.5)" />
            <TextInput
              style={styles.locationInput}
              value={location}
              onChangeText={(v) => edit('location', v)}
              placeholder="Add a location"
              placeholderTextColor="rgba(255,255,255,0.45)"
            />
          </View>
          <View style={styles.companionsRow}>
            <RivalIcon name="groups" size={12} color="rgba(255,255,255,0.5)" />
            <TextInput
              style={styles.companionsInput}
              value={companions}
              onChangeText={(v) => edit('companions', v)}
              placeholder="Who did you train with?"
              placeholderTextColor="rgba(255,255,255,0.45)"
            />
          </View>

          {/* Subtle warm dark panel (not the bright beige "input field" look
              this replaced) with the label sitting inside it, top-left —
              text reads as ink on a page, not as filled-out form UI. */}
          <View style={styles.journalPanel}>
            <Text style={styles.journalPanelLabel}>Journal</Text>
            <View style={styles.journalPanelRule} />
            <TextInput
              ref={journalRef}
              style={[styles.journalInput, { height: journalHeight }]}
              value={notes}
              onChangeText={(v) => edit('notes', v)}
              onContentSizeChange={(e) => setJournalHeight(Math.max(22, e.nativeEvent.contentSize.height))}
              placeholder="What made this one worth remembering?"
              placeholderTextColor="rgba(255,255,255,0.3)"
              multiline
            />
          </View>

          {dirty && (
            <View style={styles.saveRow}>
              <TouchableOpacity style={styles.discardBtn} onPress={discardChanges} disabled={saving}>
                <Text style={styles.discardBtnLabel}>Discard</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={saveChanges} disabled={saving}>
                <Text style={styles.saveBtnLabel}>{saving ? 'Saving…' : 'Save'}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Ring sits OUTSIDE the ScrollView so it never scrolls with content —
          same reasoning as the mockup's #viewerRing sibling element. A plain
          border works fine here (unlike the mockup's CSS, which needed an
          ::after overlay to dodge borders shrinking a shared padding box) —
          this ring has no children of its own, so there's no box to shrink. */}
      {badgeKind && <View pointerEvents="none" style={[styles.ring, { borderColor: ringColor }]} />}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#0a0a0a', zIndex: 500 },
  dragHandleArea: { position: 'absolute', top: 0, left: 0, right: 0, height: 26, alignItems: 'center', justifyContent: 'center', zIndex: 6 },
  dragHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)' },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },

  photoArea: { height: '70%' as any, minHeight: 400, position: 'relative', overflow: 'hidden', backgroundColor: '#211c19' },
  photo: { width: '100%', height: '100%' },
  photoFallback: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', backgroundColor: '#2d241f', gap: 4 },
  addPhotoCircle: { width: 56, height: 56, borderRadius: 28, borderWidth: 1.5, borderColor: RivalColors.accentText, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  addPhotoLabel: { fontSize: 15, fontWeight: '700', color: RivalColors.accentText },
  addPhotoSub: { fontSize: 12, fontWeight: '500', color: 'rgba(255,255,255,0.5)', marginTop: 2, maxWidth: 220, textAlign: 'center' },

  headerScrim: { position: 'absolute', top: 0, left: 0, right: 0, height: 90 },
  // zIndex above `tapArea` below — tapArea renders after this in JSX and
  // would otherwise stack on top on web, swallowing taps on these buttons
  // (this was the cause of the close button appearing dead).
  header: { position: 'absolute', top: 18, left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', zIndex: 5 },
  headerDate: { fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.92)' },
  saveStatusText: { fontSize: 10, fontWeight: '600', color: RivalColors.accentText, marginTop: 2 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pinCorner: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.32)', alignItems: 'center', justifyContent: 'center' },
  counter: { backgroundColor: 'rgba(0,0,0,0.32)', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 },
  counterText: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.85)' },
  closeBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.32)', alignItems: 'center', justifyContent: 'center' },

  photoBottomScrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 110 },
  photoStats: { position: 'absolute', left: 16, right: 16, bottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  photoChips: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  photoChip: { backgroundColor: 'rgba(0,0,0,0.4)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  photoChipText: { fontSize: 12, fontWeight: '600', color: 'rgba(255,255,255,0.92)' },
  photoEffort: { flexDirection: 'row', alignItems: 'baseline', gap: 4, backgroundColor: 'rgba(0,0,0,0.4)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', borderRadius: 999, paddingLeft: 14, paddingRight: 12, paddingVertical: 5 },
  photoEffortNum: { fontSize: 15, fontWeight: '800', color: '#fff' },
  photoEffortUnit: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: 'rgba(255,255,255,0.7)' },

  tapArea: { position: 'absolute', top: 0, height: '100%', width: '42%' },
  tapAreaLeft: { left: 0 },
  tapAreaRight: { right: 0 },

  // Warm dark brown instead of the generic near-black surfaceLow — matches
  // the terracotta/brown palette the card grid and recap card already use.
  footer: { backgroundColor: '#1a1512', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)', padding: 20, paddingBottom: 100, minHeight: '30%' as any },
  typeKicker: { fontSize: 13, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: RivalColors.accentText },
  nameInput: { marginTop: 3, padding: 0, fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 22, fontWeight: '700', color: '#fff', lineHeight: 28, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
  // Solid at the left, fades out toward the right — a separate gradient bar
  // (plain borders can't fade), same pattern as the Month calendar's title.
  nameUnderline: {
    width: 150, height: 1.5, marginTop: 4, marginBottom: 2,
    ...(Platform.OS === 'web' ? {
      backgroundImage: 'linear-gradient(90deg, rgba(217,199,172,0.9) 0%, rgba(217,199,172,0.9) 40%, rgba(217,199,172,0) 100%)',
    } as any : { backgroundColor: 'rgba(217,199,172,0.9)' }),
  },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  locationInput: { flex: 1, padding: 0, fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.55)', ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },
  companionsRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  companionsInput: { flex: 1, padding: 0, fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.55)', ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}) },

  // Subtle warm dark panel, barely lifted off the footer's own background —
  // a bright beige fill read as a filled-out form input, competing with the
  // photo for attention. This is quieter: text reads as ink on a page.
  // Tighter padding than before — let the text (not empty dark space)
  // determine the block's height, so it reads as a reflection, not a component.
  journalPanel: { marginTop: 20, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)', paddingHorizontal: 14, paddingVertical: 10 },
  // Negative marginLeft pulls the label past the panel's own horizontal
  // padding, flush with its true left edge (the journal body text below
  // keeps the normal padding).
  journalPanelLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: RivalColors.accentText },
  // Same solid-line treatment as the title's underline (nameUnderline) —
  // "carries that language" into the journal instead of a separate boxed
  // look, per feedback that the title's rule already does a lot of work.
  // Same solid-left-fades-right treatment as nameUnderline, tinted the
  // journal's accent orange instead of the title's cream/brown.
  journalPanelRule: {
    alignSelf: 'flex-start',
    width: 60, height: 1, marginTop: 6, marginBottom: 8,
    ...(Platform.OS === 'web' ? {
      backgroundImage: 'linear-gradient(90deg, rgba(217,119,87,0) 0%, rgba(217,119,87,0.6) 25%, rgba(217,119,87,0.6) 75%, rgba(217,119,87,0) 100%)',
    } as any : { backgroundColor: 'rgba(217,119,87,0.6)' }),
  },
  // outlineStyle suppresses the browser's default blue focus ring on web —
  // RNW passes this straight through to the underlying <textarea>'s CSS.
  journalInput: {
    padding: 0, backgroundColor: 'transparent',
    fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 16, lineHeight: 22, letterSpacing: 0.1,
    color: 'rgba(255,255,255,0.85)', minHeight: 22,
    // overflow:'hidden' — without this the underlying <textarea> falls back
    // to its own native scrollbar the instant content height and the
    // JS-driven `height` state are even momentarily out of sync (one
    // keystroke behind, since onContentSizeChange fires after the render).
    // The box should only ever grow; the outer page scrolls, not this box.
    overflow: 'hidden',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },

  // Content-width pills (not flex:1 full-width) matching PhotoPositioner's
  // skip/confirm pair — the equal-split full-width version read as bulky
  // for what's ultimately a secondary confirmation, not a primary CTA.
  saveRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 24 },
  discardBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: RivalRadius.full, borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)', alignItems: 'center' },
  discardBtnLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 0.2, color: RivalColors.textSecondary },
  saveBtn: { paddingVertical: 8, paddingHorizontal: 17, borderRadius: RivalRadius.full, backgroundColor: RivalColors.accentFill, alignItems: 'center' },
  saveBtnLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.2, color: RivalColors.onAccentFill },

  ring: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderWidth: 4 },
});
