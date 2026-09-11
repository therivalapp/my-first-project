import { useEffect, useState } from 'react';
import { StyleSheet, TouchableOpacity, View, Text, TextInput, ScrollView, Image, Platform, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { supabase, getAuthUser } from '../lib/supabase';
import { calculateEffortScore, loadScoringConfig, ScoringConfig } from '../lib/effort';
import { isoToDisplayDate, displayToIsoDate } from '../lib/dateFormat';
import { findMatchingRaceId } from '../lib/raceMatch';
import { formatDuration } from '../lib/format';
import { confirmAction } from '../lib/notify';
import { CANONICAL_LIFTS, matchCanonicalLift } from './scan-workout';
import { RivalButton, RivalCard, RivalIcon, activityIconName, RivalBackButton, RivalDateField } from '../components/rival';
import { RivalColors, RivalRadius, RivalType } from '../constants/rivalTheme';
import { BREAKPOINT_WIDE_LAYOUT } from '../constants/breakpoints';

type MediaItem = { blob: Blob; uri: string; type: 'photo' | 'video'; mimeType: string; ext: string };
type Exercise = { name: string; sets?: number; reps?: number; weight?: number };

const KG_PER_LB = 0.453592;

// label is what the user sees; `type` is the canonical activity_type stored in the DB.
const TYPE_OPTIONS: Array<{ type: string; label: string }> = [
  { type: 'Run', label: 'Run' },
  { type: 'Ride', label: 'Ride' },
  { type: 'Swim', label: 'Swim' },
  { type: 'Rowing', label: 'Rowing' },
  { type: 'WeightTraining', label: 'Weights' },
  { type: 'CrossFit', label: 'CrossFit' },
  { type: 'Hyrox', label: 'Hyrox' },
  { type: 'Bootcamp', label: 'Bootcamp' },
  { type: 'HIIT', label: 'HIIT' },
];

// Class-based formats are almost always a full ~45-60min session; mirror the
// scan screen's floor so a 15-min WOD isn't logged as a 15-min session.
const CLASS_BASED_TYPES = new Set(['CrossFit', 'Hyrox', 'HIIT', 'Bootcamp']);
const CLASS_DURATION_FLOOR_SECONDS = 45 * 60;

const MAX_PHOTOS = 2;
const MAX_VIDEOS = 1;
const MAX_PHOTO_MB = 15;
const MAX_VIDEO_MB = 50;

function todayDisplay(): string {
  const d = new Date();
  return isoToDisplayDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
}

export default function ManualEntryScreen() {
  const { width } = useWindowDimensions();
  const wide = width >= BREAKPOINT_WIDE_LAYOUT;
  // Prefills the date when opened from the Month calendar ("tap a logged-
  // looking empty day" → jump straight to logging that day), passed as
  // ?date=YYYY-MM-DD. Falls back to today for every other entry point
  // (the FAB, "Add Workout" screen, etc. never pass this param).
  const { date: prefillDateIso, editId } = useLocalSearchParams<{ date?: string; editId?: string }>();
  const isEditMode = !!editId;

  const [workoutType, setWorkoutType] = useState('Run');
  const [workoutName, setWorkoutName] = useState('');
  const [dateStr, setDateStr] = useState(() => (prefillDateIso ? isoToDisplayDate(prefillDateIso) || todayDisplay() : todayDisplay()));
  const [durationMin, setDurationMin] = useState('');
  const [durationSec, setDurationSec] = useState('');
  const [distanceKm, setDistanceKm] = useState('');
  const [elevationM, setElevationM] = useState('');
  const [notes, setNotes] = useState('');
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [showExercises, setShowExercises] = useState(false);
  const [weightUnit, setWeightUnit] = useState<'kg' | 'lb'>('kg');
  const [nameSuggestIndex, setNameSuggestIndex] = useState<number | null>(null);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Split from one screen-wide errorMsg into three, each rendered next to
  // the thing it's actually about — Ricky's call after a top-of-screen red
  // bar covered unrelated content and gave no hint which field was wrong.
  const [fieldError, setFieldError] = useState<{ field: 'name' | 'date' | 'duration'; message: string } | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [savedActivityId, setSavedActivityId] = useState<string | null>(null);
  const [savedHasPhoto, setSavedHasPhoto] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(isEditMode);
  // Preserves the original time-of-day (not just the date) when editing, so
  // changing only the date field doesn't quietly reset an activity logged at
  // 6am to whatever time you happen to be editing it.
  const [originalStartedAt, setOriginalStartedAt] = useState<Date | null>(null);
  // Held in state so the "≈ N Effort" hint can be computed synchronously on
  // every keystroke. Without it the hint fell back to the unknown-type
  // default and credited no elevation, so it read ~48 where the activity
  // would actually save as 92 — worse than showing nothing.
  const [scoringConfig, setScoringConfig] = useState<ScoringConfig | null>(null);
  useEffect(() => { loadScoringConfig().then(setScoringConfig); }, []);

  useEffect(() => {
    if (!editId) return;
    (async () => {
      const { data, error } = await supabase.from('activities').select('*').eq('id', editId).single();
      if (error || !data) { setGeneralError('Could not load this activity'); setLoadingEdit(false); return; }
      setWorkoutType(data.activity_type || 'Run');
      setWorkoutName(data.name || '');
      const started = new Date(data.started_at);
      setOriginalStartedAt(started);
      setDateStr(isoToDisplayDate(`${started.getFullYear()}-${String(started.getMonth() + 1).padStart(2, '0')}-${String(started.getDate()).padStart(2, '0')}`) || todayDisplay());
      setDurationMin(data.duration_seconds > 0 ? String(Math.floor(data.duration_seconds / 60)) : '');
      setDurationSec(data.duration_seconds > 0 ? String(data.duration_seconds % 60) : '');
      setDistanceKm(data.distance_meters > 0 ? String(data.distance_meters / 1000) : '');
      setElevationM(data.elevation_meters > 0 ? String(Math.round(data.elevation_meters)) : '');
      setNotes(data.notes || '');
      if (Array.isArray(data.exercises)) setExercises(data.exercises);
      setLoadingEdit(false);
    })();
  }, [editId]);

  // Projected effort so the user gets immediate feedback before saving.
  const durationSeconds = (() => {
    const mins = durationMin.trim() === '' ? 0 : Number(durationMin);
    const secs = durationSec.trim() === '' ? 0 : Number(durationSec);
    const raw = (Number.isFinite(mins) ? mins * 60 : 0) + (Number.isFinite(secs) ? secs : 0);
    return CLASS_BASED_TYPES.has(workoutType) && raw > 0 && raw < 30 * 60 ? CLASS_DURATION_FLOOR_SECONDS : raw;
  })();

  function checkMediaLimits(type: 'photo' | 'video', sizeMb: number, photoCount: number, videoCount: number): string | null {
    if (type === 'video' && sizeMb > MAX_VIDEO_MB) return `Video too large (max ${MAX_VIDEO_MB}MB)`;
    if (type === 'photo' && sizeMb > MAX_PHOTO_MB) return `Photo too large (max ${MAX_PHOTO_MB}MB)`;
    if (type === 'photo' && photoCount >= MAX_PHOTOS) return `Max ${MAX_PHOTOS} photos per workout`;
    if (type === 'video' && videoCount >= MAX_VIDEOS) return `Max ${MAX_VIDEOS} video per workout`;
    return null;
  }

  function pickMedia() {
    if (Platform.OS === 'web') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*,video/*';
      input.multiple = true;
      input.onchange = () => {
        const files = Array.from(input.files || []);
        setMediaError(null);
        setMedia((prev) => {
          let photoCount = 0, videoCount = 0;
          prev.forEach((m) => (m.type === 'video' ? videoCount++ : photoCount++));
          const accepted: MediaItem[] = [];
          for (const file of files) {
            const type: 'photo' | 'video' = file.type.startsWith('video') ? 'video' : 'photo';
            const rejection = checkMediaLimits(type, file.size / (1024 * 1024), photoCount, videoCount);
            if (rejection) { setMediaError(rejection); continue; }
            const uri = URL.createObjectURL(file);
            const ext = file.name.split('.').pop() || (type === 'video' ? 'mp4' : 'jpg');
            accepted.push({ blob: file, uri, type, mimeType: file.type, ext });
            if (type === 'video') videoCount++; else photoCount++;
          }
          return [...prev, ...accepted];
        });
      };
      input.click();
      return;
    }
    pickMediaNative();
  }

  async function pickMediaNative() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setMediaError('Photo library access is needed to add photos/videos'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], allowsMultipleSelection: true, quality: 0.8 });
    if (result.canceled || !result.assets?.length) return;
    setMediaError(null);
    let photoCount = media.filter((m) => m.type === 'photo').length;
    let videoCount = media.filter((m) => m.type === 'video').length;
    const accepted: MediaItem[] = [];
    for (const asset of result.assets) {
      const type: 'photo' | 'video' = asset.type === 'video' ? 'video' : 'photo';
      const blob = await (await fetch(asset.uri)).blob();
      const rejection = checkMediaLimits(type, blob.size / (1024 * 1024), photoCount, videoCount);
      if (rejection) { setMediaError(rejection); continue; }
      const mimeType = asset.mimeType || (type === 'video' ? 'video/mp4' : 'image/jpeg');
      const ext = asset.fileName?.split('.').pop() || (type === 'video' ? 'mp4' : 'jpg');
      accepted.push({ blob, uri: asset.uri, type, mimeType, ext });
      if (type === 'video') videoCount++; else photoCount++;
    }
    setMedia((prev) => [...prev, ...accepted]);
  }

  function removeMedia(index: number) {
    setMedia((prev) => prev.filter((_, i) => i !== index));
  }

  // ---- Exercises (optional, for strength sessions) ------------------------
  function kgToDisplay(kg: number | undefined): string {
    if (kg == null) return '';
    const val = weightUnit === 'lb' ? kg / KG_PER_LB : kg;
    return String(Math.round(val * 10) / 10);
  }
  function displayToKg(value: string): number | undefined {
    if (value.trim() === '') return undefined;
    const num = Number(value);
    if (!Number.isFinite(num)) return undefined;
    return weightUnit === 'lb' ? num * KG_PER_LB : num;
  }
  function addExercise() { setExercises((prev) => [...prev, { name: '' }]); }
  function removeExercise(index: number) {
    setExercises((prev) => prev.filter((_, i) => i !== index));
    if (nameSuggestIndex === index) setNameSuggestIndex(null);
  }
  function updateExerciseName(index: number, value: string) {
    setExercises((prev) => prev.map((ex, i) => i === index ? { ...ex, name: value } : ex));
  }
  function updateExerciseNum(index: number, field: 'sets' | 'reps' | 'weightDisplay', value: string) {
    setExercises((prev) => prev.map((ex, i) => {
      if (i !== index) return ex;
      if (field === 'weightDisplay') return { ...ex, weight: displayToKg(value) };
      const num = value.trim() === '' ? undefined : Number(value);
      return { ...ex, [field]: Number.isFinite(num as number) ? num : undefined };
    }));
  }
  // Canonical-lift name suggestions (substring match) so a typed "shoulder"
  // surfaces "Overhead Press" and the lift feeds the PR tracker on save.
  function liftSuggestions(input: string): string[] {
    const q = (input || '').trim().toLowerCase();
    if (!q || matchCanonicalLift(input)) return [];
    return CANONICAL_LIFTS.filter((lift) => lift.toLowerCase().includes(q)).slice(0, 6);
  }

  // "Discard Workout" only makes sense for a not-yet-saved entry (router.back()
  // with nothing written). In edit mode there's an existing saved activity —
  // this actually deletes it (activity_media cascades; exercise_entries are
  // ON DELETE SET NULL, harmless orphans left behind on a row that's gone).
  async function deleteActivity() {
    if (!editId) return;
    if (!(await confirmAction({ title: 'Delete this activity?', message: "This can't be undone.", confirmLabel: 'Delete', destructive: true }))) return;
    setDeleting(true);
    const { error } = await supabase.from('activities').delete().eq('id', editId);
    if (error) {
      setGeneralError(`Delete failed: ${error.message}`);
      setDeleting(false);
      return;
    }
    router.back();
  }

  async function saveSession() {
    if (!workoutName.trim()) { setFieldError({ field: 'name', message: 'Give your session a name' }); return; }
    if (durationSeconds <= 0) { setFieldError({ field: 'duration', message: 'Add how long you trained' }); return; }
    const isoDate = displayToIsoDate(dateStr);
    if (!isoDate) { setFieldError({ field: 'date', message: 'Enter a valid date' }); return; }

    setSaving(true);
    setFieldError(null);
    setGeneralError(null);
    try {
      const { data: { user } } = await getAuthUser();
      if (!user) { setSaving(false); return; }

      const distance = distanceKm.trim() === '' ? 0 : Number(distanceKm);
      const elevation = elevationM.trim() === '' ? 0 : Number(elevationM);
      const effortScore = calculateEffortScore(
        workoutType,
        durationSeconds,
        elevation,
        await loadScoringConfig(),
      );

      const [y, m, d] = isoDate.split('-').map(Number);
      // Editing keeps the activity's original time-of-day — only the
      // date portion is replaceable here, so a 6am run stays a 6am run
      // even if you only meant to fix its distance.
      const timeSource = isEditMode && originalStartedAt ? originalStartedAt : new Date();
      const startedAt = new Date(y, m - 1, d, timeSource.getHours(), timeSource.getMinutes(), timeSource.getSeconds());

      // Only keep exercises the user actually named; tag canonical lifts so
      // they group with existing PR history in the feed/activity record.
      const namedExercises = exercises.filter((ex) => ex.name.trim());
      const exercisesPayload = namedExercises.length > 0
        ? namedExercises.map((ex) => {
            const canonical = matchCanonicalLift(ex.name);
            return canonical ? { ...ex, prLift: canonical } : ex;
          })
        : null;

      const raceId = await findMatchingRaceId(user.id, startedAt.toISOString());

      let activityId: string;
      if (isEditMode) {
        const { error } = await supabase
          .from('activities')
          .update({
            name: workoutName.trim(),
            activity_type: workoutType,
            distance_meters: distance * 1000,
            duration_seconds: durationSeconds,
            elevation_meters: elevation,
            started_at: startedAt.toISOString(),
            effort_score: effortScore,
            raw_effort_score: effortScore,
            notes: notes.trim() || null,
            exercises: exercisesPayload,
            race_id: raceId,
          })
          .eq('id', editId);
        if (error) {
          setGeneralError(`Save failed: ${error.message}`);
          setSaving(false);
          return;
        }
        activityId = editId as string;
        // Re-sync the PR tracker's lift rows with whatever's now in the form
        // — simplest correct approach is drop-and-reinsert rather than diffing.
        // If the old rows can't be cleared, re-inserting below would DOUBLE the
        // athlete's lifts for this workout and corrupt their PR history, so stop
        // rather than press on.
        const { error: clearErr } = await supabase.from('exercise_entries').delete().eq('activity_id', activityId);
        if (clearErr) {
          setGeneralError(`Couldn't update your lifts: ${clearErr.message}`);
          setSaving(false);
          return;
        }
      } else {
        const { data: inserted, error } = await supabase
          .from('activities')
          .insert({
            user_id: user.id,
            name: workoutName.trim(),
            activity_type: workoutType,
            distance_meters: distance * 1000,
            duration_seconds: durationSeconds,
            elevation_meters: elevation,
            started_at: startedAt.toISOString(),
            effort_score: effortScore,
            raw_effort_score: effortScore,
            notes: notes.trim() || null,
            exercises: exercisesPayload,
            provider: 'rival_manual',
            provider_activity_id: `manual-${Date.now()}`,
            race_id: raceId,
          })
          .select('id')
          .single();

        if (error || !inserted) {
          if (error?.message?.includes('activities_started_at_not_future')) {
            setFieldError({ field: 'date', message: "That's in the future — activities can't be logged ahead of time." });
          } else {
            setGeneralError(`Save failed: ${error?.message ?? 'unknown error'}`);
          }
          setSaving(false);
          return;
        }
        activityId = inserted.id;
      }

      // Lift entries feed the PR tracker. Use the canonical name when we
      // recognise the lift (so it groups with existing history), else the
      // user's own name title-cased. Only weighted, named lifts count.
      const liftEntries = namedExercises
        .map((ex) => ({
          user_id: user.id,
          activity_id: activityId,
          exercise_name: matchCanonicalLift(ex.name)
            || ex.name.trim().replace(/\b\w/g, (c) => c.toUpperCase()),
          weight_kg: ex.weight,
          reps: ex.reps ?? null,
          performed_at: startedAt.toISOString(),
        }))
        .filter((e) => !!e.weight_kg && !!e.exercise_name);
      if (liftEntries.length > 0) {
        const { error: liftErr } = await supabase.from('exercise_entries').insert(liftEntries);
        // The activity itself is already saved, so this is reported rather than
        // fatal -- but silently dropping the lifts would leave the PR tracker
        // quietly wrong.
        if (liftErr) setGeneralError(`Workout saved, but the lifts didn't attach: ${liftErr.message}`);
      }

      // Upload media, set the first photo as the activity's cover.
      let firstPhotoUrl: string | null = null;
      for (const item of media) {
        const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const path = `${user.id}/${activityId}-${uniqueId}.${item.ext}`;
        const { error: storageErr } = await supabase.storage
          .from('activity-photos')
          .upload(path, item.blob, { contentType: item.mimeType, upsert: true });
        if (storageErr) { console.error('Media upload failed:', storageErr.message); continue; }
        const { data: urlData } = supabase.storage.from('activity-photos').getPublicUrl(path);
        const { error: mediaErr } = await supabase.from('activity_media').insert({ activity_id: activityId, media_url: urlData.publicUrl, media_type: item.type });
        if (mediaErr) { console.error('Media row insert failed:', mediaErr.message); continue; }
        if (item.type === 'photo' && !firstPhotoUrl) firstPhotoUrl = urlData.publicUrl;
      }
      if (firstPhotoUrl) {
        const { error: coverErr } = await supabase.from('activities').update({ photo_url: firstPhotoUrl }).eq('id', activityId);
        if (coverErr) setGeneralError(`Workout saved, but the cover photo didn't set: ${coverErr.message}`);
      }

      // Milestones are earned off total hours — recheck fire-and-forget.
      const { data: { session } } = await supabase.auth.getSession();
      if (session) fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/check-milestones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}`, 'apikey': process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY! },
      }).catch(() => {});

      if (isEditMode) {
        router.replace('/my-activities');
        return;
      }
      setSavedActivityId(activityId);
      setSavedHasPhoto(!!firstPhotoUrl);
      // With a photo, offer to AI-enhance before leaving; otherwise head to the feed.
      if (!firstPhotoUrl) setTimeout(() => router.replace('/my-activities'), 900);
    } catch (err) {
      console.error('Save failed:', err);
      setGeneralError('Failed to save session');
    } finally {
      setSaving(false);
    }
  }

  // ---- Left column: type + name + date ------------------------------------
  const typeCard = (
    <RivalCard glass style={styles.panel}>
      <Text style={styles.panelLabel}>WORKOUT TYPE</Text>
      <View style={styles.typeGrid}>
        {TYPE_OPTIONS.map((opt) => {
          const selected = workoutType === opt.type;
          return (
            <TouchableOpacity
              key={opt.type}
              style={[styles.typeCard, selected && styles.typeCardSelected]}
              onPress={() => setWorkoutType(opt.type)}
            >
              <RivalIcon name={activityIconName(opt.type)} size={22} color={selected ? RivalColors.accentText : RivalColors.textSecondary} />
              <Text style={[styles.typeLabel, selected && { color: RivalColors.accentText }]}>{opt.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </RivalCard>
  );

  const detailsCard = (
    <RivalCard glass style={styles.panel}>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>WORKOUT NAME</Text>
        <TextInput
          style={styles.input}
          value={workoutName}
          onChangeText={(v) => { setWorkoutName(v); if (fieldError?.field === 'name') setFieldError(null); }}
          placeholder="e.g., Morning Tempo Run"
          placeholderTextColor={RivalColors.textSecondary}
        />
        {fieldError?.field === 'name' && <Text style={styles.fieldError}>⚠️ {fieldError.message}</Text>}
      </View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>DATE</Text>
        <RivalDateField
          value={dateStr}
          onChangeText={(v) => { setDateStr(v); if (fieldError?.field === 'date') setFieldError(null); }}
          inputStyle={styles.input}
        />
        {fieldError?.field === 'date' && <Text style={styles.fieldError}>⚠️ {fieldError.message}</Text>}
      </View>
    </RivalCard>
  );

  // ---- Right column: metrics + comments + media ---------------------------
  const metric = (label: string, unit: string, value: string, onChange: (v: string) => void, placeholder: string, keyboardType: 'numeric' | 'decimal-pad' = 'numeric') => (
    <View style={styles.metricBox}>
      <Text style={styles.metricLabel}>{label}</Text>
      <View style={styles.metricInputRow}>
        <TextInput
          style={styles.metricInput}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={RivalColors.textSecondary}
          keyboardType={keyboardType}
        />
        <Text style={styles.metricUnit}>{unit}</Text>
      </View>
    </View>
  );

  // Duration gets its own layout rather than the generic `metric` box — two
  // narrow fields (min, sec) sharing the space a single number used to have,
  // so a sub-minute correction doesn't need converting to a decimal.
  const durationMetric = (
    <View style={styles.metricBox}>
      <Text style={styles.metricLabel}>DURATION</Text>
      <View style={styles.metricInputRow}>
        <TextInput
          style={[styles.metricInput, styles.metricInputNarrow]}
          value={durationMin}
          onChangeText={(v) => { setDurationMin(v); if (fieldError?.field === 'duration') setFieldError(null); }}
          placeholder="0"
          placeholderTextColor={RivalColors.textSecondary}
          keyboardType="numeric"
        />
        <Text style={styles.metricUnit}>min</Text>
        <TextInput
          style={[styles.metricInput, styles.metricInputNarrow]}
          value={durationSec}
          onChangeText={(v) => {
            // Clamp to 0-59 as you type rather than after — "75 sec" isn't a
            // typo to catch on save, it's just 1:15, which belongs in the min
            // field, so keep sec honest to what it actually represents.
            const n = v.replace(/\D/g, '').slice(0, 2);
            const clamped = n === '' ? '' : String(Math.min(59, Number(n)));
            setDurationSec(clamped);
            if (fieldError?.field === 'duration') setFieldError(null);
          }}
          placeholder="0"
          placeholderTextColor={RivalColors.textSecondary}
          keyboardType="numeric"
          maxLength={2}
        />
        <Text style={styles.metricUnit}>sec</Text>
      </View>
    </View>
  );

  const metricsCard = (
    <RivalCard glass style={styles.panel}>
      <Text style={styles.panelLabel}>CORE PERFORMANCE METRICS</Text>
      <View style={styles.metricsRow}>
        {durationMetric}
        {metric('DISTANCE', 'KM', distanceKm, setDistanceKm, '0.00', 'decimal-pad')}
        {metric('ELEVATION', 'M', elevationM, setElevationM, '0')}
      </View>
      {fieldError?.field === 'duration' && <Text style={styles.fieldError}>⚠️ {fieldError.message}</Text>}
      {durationSeconds > 0 && (
        <Text style={styles.effortPreview}>
          ≈ {Math.round(calculateEffortScorePreview(workoutType, durationSeconds, elevationM, scoringConfig))} Effort · {formatDuration(durationSeconds)}
        </Text>
      )}
      {CLASS_BASED_TYPES.has(workoutType) && durationSeconds >= CLASS_DURATION_FLOOR_SECONDS && durationMin.trim() !== '' && Number(durationMin) * 60 < 30 * 60 && (
        <Text style={styles.classHint}>CrossFit/Hyrox/HIIT sessions are counted as a full class (45 min) — include warm-up & skill work, not just the timed piece.</Text>
      )}
      {generalError && <Text style={styles.fieldError}>⚠️ {generalError}</Text>}
      <RivalButton
        label={saving ? 'Saving…' : isEditMode ? 'Save Changes' : 'Complete Session'}
        onPress={saveSession}
        disabled={saving || !!savedActivityId}
        style={styles.completeBtn}
      />
      {isEditMode ? (
        <TouchableOpacity onPress={deleteActivity} disabled={saving || deleting}>
          <Text style={styles.discard}>{deleting ? 'Deleting…' : 'Delete Activity'}</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity onPress={() => router.back()} disabled={saving}>
          <Text style={styles.discard}>Discard Workout</Text>
        </TouchableOpacity>
      )}
    </RivalCard>
  );

  const commentsCard = (
    <RivalCard glass style={styles.panel}>
      <Text style={styles.panelLabel}>COMMENTS</Text>
      <TextInput
        style={styles.notesInput}
        value={notes}
        onChangeText={setNotes}
        placeholder="Add detailed exercise notes or how the session felt…"
        placeholderTextColor={RivalColors.textSecondary}
        multiline
        numberOfLines={4}
      />
    </RivalCard>
  );

  const exercisesCard = (
    <RivalCard glass style={styles.panel}>
      <TouchableOpacity style={styles.exToggleRow} onPress={() => setShowExercises((s) => !s)}>
        <View>
          <Text style={styles.panelLabel}>EXERCISES / LIFTS</Text>
          <Text style={styles.exOptional}>Optional — log lifts to track your PBs</Text>
        </View>
        <Text style={styles.exToggleIcon}>{showExercises ? '–' : '+'}</Text>
      </TouchableOpacity>

      {showExercises && (
        <>
          {exercises.length > 0 && (
            <View style={styles.unitToggle}>
              {(['kg', 'lb'] as const).map((u) => (
                <TouchableOpacity key={u} style={[styles.unitBtn, weightUnit === u && styles.unitBtnActive]} onPress={() => setWeightUnit(u)}>
                  <Text style={[styles.unitBtnText, weightUnit === u && { color: RivalColors.accentText }]}>{u}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {exercises.map((ex, i) => (
            <View key={i} style={styles.exRow}>
              <View style={styles.exNameRow}>
                <TextInput
                  style={styles.exNameInput}
                  value={ex.name}
                  onChangeText={(v) => updateExerciseName(i, v)}
                  onFocus={() => setNameSuggestIndex(i)}
                  onBlur={() => setTimeout(() => setNameSuggestIndex((cur) => (cur === i ? null : cur)), 150)}
                  placeholder="Exercise name"
                  placeholderTextColor={RivalColors.textSecondary}
                />
                <TouchableOpacity style={styles.exRemove} onPress={() => removeExercise(i)}>
                  <RivalIcon name="close" size={16} color={RivalColors.textSecondary} />
                </TouchableOpacity>
              </View>
              {nameSuggestIndex === i && liftSuggestions(ex.name).length > 0 && (
                <View style={styles.suggestBox}>
                  {liftSuggestions(ex.name).map((s) => (
                    <TouchableOpacity key={s} style={styles.suggestItem} onPress={() => { updateExerciseName(i, s); setNameSuggestIndex(null); }}>
                      <Text style={styles.suggestText}>{s}</Text>
                      <Text style={styles.suggestHint}>PB tracked</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              <View style={styles.exFieldsRow}>
                <View style={styles.exField}>
                  <Text style={styles.exFieldLabel}>Sets</Text>
                  <TextInput style={styles.exFieldInput} value={ex.sets != null ? String(ex.sets) : ''} onChangeText={(v) => updateExerciseNum(i, 'sets', v)} placeholder="-" placeholderTextColor={RivalColors.textSecondary} keyboardType="numeric" />
                </View>
                <View style={styles.exField}>
                  <Text style={styles.exFieldLabel}>Reps</Text>
                  <TextInput style={styles.exFieldInput} value={ex.reps != null ? String(ex.reps) : ''} onChangeText={(v) => updateExerciseNum(i, 'reps', v)} placeholder="-" placeholderTextColor={RivalColors.textSecondary} keyboardType="numeric" />
                </View>
                <View style={styles.exField}>
                  <Text style={styles.exFieldLabel}>Weight ({weightUnit})</Text>
                  <TextInput style={styles.exFieldInput} value={kgToDisplay(ex.weight)} onChangeText={(v) => updateExerciseNum(i, 'weightDisplay', v)} placeholder="-" placeholderTextColor={RivalColors.textSecondary} keyboardType="numeric" />
                </View>
              </View>
            </View>
          ))}

          <TouchableOpacity style={styles.addExBtn} onPress={addExercise}>
            <Text style={styles.addExBtnText}>+ Add exercise</Text>
          </TouchableOpacity>
        </>
      )}
    </RivalCard>
  );

  const mediaCard = (
    <RivalCard glass style={styles.panel}>
      <Text style={styles.panelLabel}>PHOTOS & VIDEOS</Text>
      {media.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.mediaRow}>
          {media.map((m, i) => (
            <View key={i} style={styles.mediaThumbWrap}>
              {m.type === 'photo'
                ? <Image source={{ uri: m.uri }} style={styles.mediaThumb} />
                : <View style={[styles.mediaThumb, styles.mediaVideo]}><Text style={styles.mediaVideoIcon}>🎬</Text></View>}
              <TouchableOpacity style={styles.mediaRemove} onPress={() => removeMedia(i)}>
                <RivalIcon name="close" size={14} color={RivalColors.textPrimary} />
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}
      <TouchableOpacity style={styles.dropzone} onPress={pickMedia}>
        <RivalIcon name="upload" size={24} color={RivalColors.textPrimary} />
        <Text style={styles.dropzoneTitle}>Click to upload</Text>
        <Text style={styles.dropzoneSub}>Up to {MAX_PHOTOS} photos + {MAX_VIDEOS} video · PNG, JPG, MP4</Text>
      </TouchableOpacity>
      {mediaError && <Text style={styles.fieldError}>⚠️ {mediaError}</Text>}
    </RivalCard>
  );

  const saved = !!savedActivityId;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <RivalBackButton onPress={() => router.back()} color={RivalColors.accentFill} />
        </View>

        <Text style={styles.title}>{isEditMode ? 'Edit Your Session' : 'Log Your Session'}</Text>
        <Text style={styles.subtitle}>
          {isEditMode ? 'Update the details below — changes recalculate your Effort automatically.' : 'Capture your session so it counts toward your Effort and your team.'}
        </Text>

        {loadingEdit && <Text style={styles.subtitle}>Loading activity…</Text>}

        {saved && (
          <View style={styles.successBanner}>
            <Text style={styles.successText}>✓ Session saved!</Text>
            {savedHasPhoto ? (
              <View style={styles.successActions}>
                <TouchableOpacity style={[styles.enhanceBtn, { flexDirection: 'row', alignItems: 'center', gap: 6 }]} onPress={() => router.replace(`/ai-share?activityId=${savedActivityId}`)}>
                  <RivalIcon name="ai" size={16} color={RivalColors.onAccentFill} />
                  <Text style={styles.enhanceBtnText}>AI Enhance your photo</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => router.replace('/my-activities')}>
                  <Text style={styles.doneText}>Done</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <Text style={styles.doneText}>Taking you to your activities…</Text>
            )}
          </View>
        )}

        {!loadingEdit && (
          <View style={[wide && styles.twoCol]}>
            <View style={[wide && styles.leftCol]}>
              {typeCard}
              {detailsCard}
            </View>
            <View style={[wide && styles.rightCol]}>
              {metricsCard}
              {commentsCard}
              {exercisesCard}
              {mediaCard}
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// The on-screen "≈ N Effort" hint. Uses the same formula and the same live
// config as the save path, so what the athlete is shown before saving is what
// they actually get — until the config has loaded, in which case there is
// nothing honest to show yet.
function calculateEffortScorePreview(
  type: string,
  durationSeconds: number,
  elevationM: string,
  config: ScoringConfig | null,
): number {
  if (!config) return 0;
  const elevation = elevationM.trim() === '' ? 0 : Number(elevationM);
  return calculateEffortScore(type, durationSeconds, elevation, config);
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: RivalColors.surfaceLow },
  content: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 48, maxWidth: 1200, width: '100%', alignSelf: 'center' },
  header: { marginBottom: 8 },
  back: { color: RivalColors.accentText, fontSize: 16 },
  title: { ...RivalType.headlineLg, color: RivalColors.textPrimary, marginTop: 8 },
  subtitle: { ...RivalType.bodyMd, fontSize: 14, color: RivalColors.textSecondary, marginBottom: 24 },

  // Sits directly under (or beside, for the metrics row) whatever it's
  // actually about — replaces a single fixed top banner that covered the
  // rest of the screen with no clue which field it referred to.
  fieldError: { color: RivalColors.error, fontSize: 12, fontWeight: '600' },

  successBanner: { backgroundColor: `${RivalColors.success}22`, borderRadius: RivalRadius.lg, padding: 16, marginBottom: 20, gap: 8, alignItems: 'center' },
  successText: { color: RivalColors.success, fontSize: 15, fontWeight: '700' },
  successActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  enhanceBtn: { backgroundColor: RivalColors.accentFill, borderRadius: RivalRadius.DEFAULT, paddingHorizontal: 16, paddingVertical: 10 },
  enhanceBtnText: { color: RivalColors.onAccentFill, fontWeight: '700', fontSize: 14 },
  doneText: { color: RivalColors.textSecondary, fontSize: 14 },

  twoCol: { flexDirection: 'row', gap: 16, alignItems: 'flex-start' },
  leftCol: { width: '38%', minWidth: 300, maxWidth: 420, flexGrow: 0, flexShrink: 0, gap: 16 },
  rightCol: { flex: 1, gap: 16 },

  panel: { padding: 20, gap: 14, marginBottom: 16 },
  panelLabel: { ...RivalType.labelCaps, color: RivalColors.accentText },

  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  typeCard: { flexBasis: '47%', flexGrow: 1, alignItems: 'center', gap: 6, paddingVertical: 18, borderRadius: RivalRadius.DEFAULT, borderWidth: 1, borderColor: RivalColors.outlineVariant, backgroundColor: RivalColors.surfaceLow },
  typeCardSelected: { borderColor: RivalColors.accentFill, backgroundColor: `${RivalColors.accentFill}22` },
  typeIcon: { fontSize: 22 },
  typeLabel: { fontSize: 13, fontWeight: '700', color: RivalColors.textSecondary },

  field: { gap: 6 },
  fieldLabel: { ...RivalType.labelCaps, fontSize: 11, color: RivalColors.textSecondary },
  input: { backgroundColor: RivalColors.surfaceContainer, borderRadius: RivalRadius.DEFAULT, paddingHorizontal: 14, paddingVertical: 12, color: RivalColors.textPrimary, fontSize: 15 },

  metricsRow: { flexDirection: 'row', gap: 10 },
  metricBox: { flex: 1, backgroundColor: RivalColors.surfaceContainer, borderRadius: RivalRadius.DEFAULT, padding: 12, gap: 8 },
  metricLabel: { ...RivalType.labelCaps, fontSize: 10, color: RivalColors.textSecondary },
  metricInputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  // minWidth:0 lets the input shrink inside the flex row on react-native-web —
  // without it the input keeps its content width and shoves the unit out of the box.
  metricInput: { flex: 1, minWidth: 0, color: RivalColors.textPrimary, fontSize: 26, fontWeight: '300', padding: 0 },
  // DURATION's min/sec pair share the same box width DISTANCE/ELEVATION give
  // a single number — smaller font and a tighter unit label keep "0 min 0
  // sec" from crowding out the box's own padding.
  metricInputNarrow: { fontSize: 18 },
  metricUnit: { fontSize: 11, color: RivalColors.textSecondary, fontWeight: '700', paddingBottom: 4, flexShrink: 0 },
  effortPreview: { fontSize: 13, color: RivalColors.accentText, fontWeight: '700' },
  classHint: { fontSize: 12, color: RivalColors.textSecondary, lineHeight: 17 },
  completeBtn: { marginTop: 4 },
  discard: { color: RivalColors.textSecondary, fontSize: 13, fontWeight: '600', textAlign: 'center', marginTop: 4 },

  notesInput: { backgroundColor: RivalColors.surfaceContainer, borderRadius: RivalRadius.DEFAULT, paddingHorizontal: 14, paddingVertical: 12, color: RivalColors.onSurface, fontSize: 15, minHeight: 110, textAlignVertical: 'top' },

  exToggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  exOptional: { fontSize: 12, color: RivalColors.textSecondary, marginTop: 2 },
  exToggleIcon: { fontSize: 22, color: RivalColors.accentText, fontWeight: '700', width: 24, textAlign: 'center' },
  unitToggle: { flexDirection: 'row', alignSelf: 'flex-start', backgroundColor: RivalColors.surfaceContainer, borderRadius: RivalRadius.DEFAULT, padding: 2, gap: 2 },
  unitBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: RivalRadius.sm },
  unitBtnActive: { backgroundColor: RivalColors.surfaceContainerHigh },
  unitBtnText: { fontSize: 13, fontWeight: '700', color: RivalColors.textSecondary },
  exRow: { gap: 8, paddingVertical: 10, borderTopWidth: 1, borderTopColor: RivalColors.outlineVariant },
  exNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  exNameInput: { flex: 1, minWidth: 0, backgroundColor: RivalColors.surfaceContainer, borderRadius: RivalRadius.DEFAULT, paddingHorizontal: 12, paddingVertical: 10, color: RivalColors.textPrimary, fontSize: 14 },
  exRemove: { width: 32, height: 32, borderRadius: RivalRadius.DEFAULT, backgroundColor: RivalColors.surfaceContainer, alignItems: 'center', justifyContent: 'center' },
  exRemoveText: { color: RivalColors.textSecondary, fontSize: 13 },
  suggestBox: { backgroundColor: RivalColors.surfaceContainerHigh, borderRadius: RivalRadius.DEFAULT, overflow: 'hidden' },
  suggestItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10 },
  suggestText: { color: RivalColors.textPrimary, fontSize: 14, fontWeight: '600' },
  suggestHint: { color: RivalColors.accentText, fontSize: 11, fontWeight: '700' },
  exFieldsRow: { flexDirection: 'row', gap: 8 },
  exField: { flex: 1, gap: 4 },
  exFieldLabel: { fontSize: 10, color: RivalColors.textSecondary, fontWeight: '700' },
  exFieldInput: { backgroundColor: RivalColors.surfaceContainer, borderRadius: RivalRadius.DEFAULT, paddingHorizontal: 10, paddingVertical: 8, color: RivalColors.textPrimary, fontSize: 14, textAlign: 'center' },
  addExBtn: { alignItems: 'center', paddingVertical: 12, borderWidth: 1, borderColor: RivalColors.outlineVariant, borderStyle: 'dashed', borderRadius: RivalRadius.DEFAULT, marginTop: 4 },
  addExBtnText: { color: RivalColors.accentText, fontSize: 14, fontWeight: '700' },

  mediaRow: { gap: 10, paddingBottom: 4 },
  mediaThumbWrap: { position: 'relative' },
  mediaThumb: { width: 72, height: 72, borderRadius: RivalRadius.DEFAULT, backgroundColor: RivalColors.surfaceContainer },
  mediaVideo: { alignItems: 'center', justifyContent: 'center' },
  mediaVideoIcon: { fontSize: 26 },
  mediaRemove: { position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: RivalColors.surfaceContainerHighest, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: RivalColors.outlineVariant },
  mediaRemoveText: { color: RivalColors.textPrimary, fontSize: 12 },
  dropzone: { borderWidth: 1, borderColor: RivalColors.outlineVariant, borderStyle: 'dashed', borderRadius: RivalRadius.DEFAULT, paddingVertical: 32, alignItems: 'center', gap: 6 },
  dropzoneIcon: { fontSize: 24 },
  dropzoneTitle: { fontSize: 14, fontWeight: '700', color: RivalColors.textPrimary },
  dropzoneSub: { fontSize: 12, color: RivalColors.textSecondary },
});
