import { useState, useEffect } from 'react';
import { RivalColors } from '../constants/rivalTheme';
import { RivalIcon, RivalBackButton} from '../components/rival';
import { StyleSheet, TouchableOpacity, View, Text, ScrollView, Image, Platform, ActivityIndicator, TextInput } from 'react-native';
import { notify } from '../lib/notify';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';
import { calculateEffortScore, loadScoringConfig } from '../lib/effort';
import { findMatchingRaceId } from '../lib/raceMatch';
import { matchCanonicalLift } from './scan-workout';

type DayImage = { uri: string; base64: string; mimeType: string };
type DayState = {
  date: Date;
  label: string;
  shortLabel: string;
  images: DayImage[];
};

type DayResult = {
  label: string;
  status: 'pending' | 'scanning' | 'saved' | 'error';
  workoutType?: string;
  xp?: number;
  errorMsg?: string;
  activityId?: string;
  name?: string;
  mediaCount?: number;
};

function getCurrentWeekDays(): DayState[] {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  monday.setHours(0, 0, 0, 0);

  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return dayLabels.map((shortLabel, i) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    return {
      date,
      label: `${shortLabel} ${date.getDate()}`,
      shortLabel,
      images: [],
    };
  });
}

// Class-based formats are almost always a full ~45-60min session even though the
// scanned WOD/board only shows the timed portion (e.g. a 15min WOD inside an hour class).
const CLASS_BASED_TYPES = new Set(['CrossFit', 'Hyrox', 'HIIT', 'Bootcamp']);
const CLASS_DURATION_FLOOR_SECONDS = 45 * 60;

function applyClassDurationFloor(workoutType: string, durationSeconds: number): number {
  if (CLASS_BASED_TYPES.has(workoutType) && durationSeconds > 0 && durationSeconds < 30 * 60) {
    return CLASS_DURATION_FLOOR_SECONDS;
  }
  return durationSeconds;
}

export default function WeeklyScanScreen() {
  const [days, setDays] = useState<DayState[]>(getCurrentWeekDays());
  const [processing, setProcessing] = useState(false);
  const [results, setResults] = useState<DayResult[] | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!errorMsg) return;
    const t = setTimeout(() => setErrorMsg(null), 5000);
    return () => clearTimeout(t);
  }, [errorMsg]);

  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);

  async function pickPhotosForDay(dayIndex: number) {
    setErrorMsg(null);

    if (Platform.OS === 'web') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.multiple = true;
      input.onchange = async () => {
        const files = Array.from(input.files || []);
        if (files.length === 0) return;

        const readFile = (file: File) => new Promise<DayImage>((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            const dataUri = e.target?.result as string;
            resolve({ uri: dataUri, base64: dataUri.split(',')[1], mimeType: file.type || 'image/jpeg' });
          };
          reader.readAsDataURL(file);
        });

        const images = await Promise.all(files.map(readFile));
        setDays((prev) => prev.map((d, i) => i === dayIndex ? { ...d, images: [...d.images, ...images] } : d));
      };
      input.click();
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setErrorMsg('Photo library access is needed to add workout photos');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 0.8,
      base64: true,
    });

    if (result.canceled || !result.assets?.length) return;

    const images: DayImage[] = result.assets
      .filter(a => a.base64)
      .map(a => ({ uri: a.uri, base64: a.base64!, mimeType: a.mimeType || 'image/jpeg' }));

    setDays((prev) => prev.map((d, i) => i === dayIndex ? { ...d, images: [...d.images, ...images] } : d));
  }

  function removeDayImage(dayIndex: number, imgIndex: number) {
    setDays((prev) => prev.map((d, i) =>
      i === dayIndex ? { ...d, images: d.images.filter((_, ii) => ii !== imgIndex) } : d
    ));
  }

  async function scanAndSaveAll() {
    const daysWithPhotos = days.filter(d => d.images.length > 0);
    if (daysWithPhotos.length === 0) {
      setErrorMsg('Add at least one photo to a day first');
      return;
    }

    setProcessing(true);
    setErrorMsg(null);
    const initialResults: DayResult[] = daysWithPhotos.map(d => ({ label: d.label, status: 'pending' }));
    setResults(initialResults);

    const { data: { user } } = await supabase.auth.getUser();
    const { data: { session } } = await supabase.auth.getSession();
    if (!user || !session) {
      setProcessing(false);
      setErrorMsg('You need to be signed in');
      return;
    }

    for (let i = 0; i < daysWithPhotos.length; i++) {
      const day = daysWithPhotos[i];
      setResults((prev) => prev!.map((r, ri) => ri === i ? { ...r, status: 'scanning' } : r));

      try {
        const response = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/scan-workout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
            'apikey': process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
          },
          body: JSON.stringify({
            images: day.images.map(img => ({ base64Image: img.base64, mediaType: img.mimeType })),
          }),
        });

        const data = await response.json();

        if (!response.ok || !data.workout) {
          setResults((prev) => prev!.map((r, ri) => ri === i ? { ...r, status: 'error', errorMsg: data.error || 'Could not read photo' } : r));
          continue;
        }

        const workout = data.workout;
        const workoutType = workout.workoutType || 'Workout';
        const duration = applyClassDurationFloor(workoutType, workout.duration || 0);
        const distance = workout.distance || 0;
        const effortScore = calculateEffortScore(workoutType, duration, workout.elevation || 0, await loadScoringConfig());

        const raceId = await findMatchingRaceId(user.id, day.date.toISOString());

        const { data: inserted, error: insertErr } = await supabase.from('activities').insert({
          user_id: user.id,
          provider: 'rival_scan',
          provider_activity_id: `scan-week-${day.date.getTime()}-${Date.now()}`,
          name: workoutType,
          activity_type: workoutType,
          distance_meters: distance * 1000,
          duration_seconds: duration,
          elevation_meters: workout.elevation || 0,
          started_at: day.date.toISOString(),
          effort_score: effortScore,
          raw_effort_score: effortScore,
          exercises: workout.exercises?.length > 0 ? workout.exercises : null,
          race_id: raceId,
        }).select('id').single();

        if (insertErr || !inserted) {
          setResults((prev) => prev!.map((r, ri) => ri === i ? { ...r, status: 'error', errorMsg: insertErr?.message } : r));
          continue;
        }

        const liftEntries = (workout.exercises || [])
          .map((ex: any) => ({ canonical: matchCanonicalLift(ex.name), ex }))
          .filter((m: any) => m.canonical && m.ex.weight)
          .map((m: any) => ({
            user_id: user.id,
            activity_id: inserted.id,
            exercise_name: m.canonical,
            weight_kg: m.ex.weight,
            reps: m.ex.reps ?? null,
            performed_at: day.date.toISOString(),
          }));
        if (liftEntries.length > 0) {
          // The activity row is already in; dropping the lifts silently would
          // leave the PR tracker quietly short.
          const { error: liftErr } = await supabase.from('exercise_entries').insert(liftEntries);
          if (liftErr) setErrorMsg(`Saved, but the lifts didn't attach: ${liftErr.message}`);
        }

        setResults((prev) => prev!.map((r, ri) => ri === i ? {
          ...r, status: 'saved', workoutType, xp: Math.round(effortScore),
          activityId: inserted.id, name: workoutType, mediaCount: 0,
        } : r));
      } catch (err: any) {
        setResults((prev) => prev!.map((r, ri) => ri === i ? { ...r, status: 'error', errorMsg: 'Failed to scan' } : r));
      }
    }

    setProcessing(false);
  }

  function startEditingName(index: number, currentName: string) {
    setEditingIndex(index);
    setEditingName(currentName);
  }

  async function saveEditedName(index: number) {
    const result = results?.[index];
    if (!result?.activityId) { setEditingIndex(null); return; }
    const trimmed = editingName.trim();
    if (!trimmed) { setEditingIndex(null); return; }

    const { error: nameErr } = await supabase.from('activities').update({ name: trimmed, name_locked: true }).eq('id', result.activityId);
    if (nameErr) {
      setErrorMsg(`Couldn't rename that workout: ${nameErr.message}`);
      setEditingIndex(null);
      return;
    }
    setResults((prev) => prev!.map((r, ri) => ri === index ? { ...r, name: trimmed } : r));
    setEditingIndex(null);
  }

  async function addPhotoToResult(index: number) {
    const result = results?.[index];
    if (!result?.activityId) return;
    setErrorMsg(null);

    if (Platform.OS === 'web') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*,video/*';
      input.multiple = true;
      input.onchange = async () => {
        const files = Array.from(input.files || []);
        if (files.length === 0) return;
        await uploadResultMedia(index, result.activityId!, files);
      };
      input.click();
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setErrorMsg('Photo library access is needed to add photos/videos');
      return;
    }

    const pickerResult = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: true,
      quality: 0.8,
    });
    if (pickerResult.canceled || !pickerResult.assets?.length) return;

    const blobs = await Promise.all(pickerResult.assets.map(async (a) => ({
      blob: await (await fetch(a.uri)).blob(),
      mimeType: a.mimeType || (a.type === 'video' ? 'video/mp4' : 'image/jpeg'),
      ext: a.fileName?.split('.').pop() || (a.type === 'video' ? 'mp4' : 'jpg'),
      mediaType: (a.type === 'video' ? 'video' : 'photo') as 'photo' | 'video',
    })));

    await uploadResultMediaBlobs(index, result.activityId!, blobs);
  }

  const MAX_PHOTOS = 2;
  const MAX_VIDEOS = 1;

  async function uploadResultMedia(index: number, activityId: string, files: File[]) {
    const blobs = files.map(file => ({
      blob: file,
      mimeType: file.type,
      ext: file.name.split('.').pop() || (file.type.startsWith('video') ? 'mp4' : 'jpg'),
      mediaType: (file.type.startsWith('video') ? 'video' : 'photo') as 'photo' | 'video',
    }));
    await uploadResultMediaBlobs(index, activityId, blobs);
  }

  async function uploadResultMediaBlobs(
    index: number,
    activityId: string,
    blobs: Array<{ blob: Blob; mimeType: string; ext: string; mediaType: 'photo' | 'video' }>
  ) {
    setUploadingIndex(index);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const existing = results?.[index]?.mediaCount || 0;
      let photoCount = 0;
      let videoCount = 0;

      for (let i = 0; i < blobs.length; i++) {
        const item = blobs[i];
        if (item.mediaType === 'photo' && photoCount >= MAX_PHOTOS) { setErrorMsg(`Max ${MAX_PHOTOS} photos per workout`); continue; }
        if (item.mediaType === 'video' && videoCount >= MAX_VIDEOS) { setErrorMsg(`Max ${MAX_VIDEOS} video per workout`); continue; }

        const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const path = `${user.id}/${activityId}-${uniqueId}.${item.ext}`;

        const { error: storageErr } = await supabase.storage
          .from('activity-photos')
          .upload(path, item.blob, { contentType: item.mimeType, upsert: true });

        if (storageErr) { setErrorMsg(`Upload failed: ${storageErr.message}`); continue; }

        const { data: urlData } = supabase.storage.from('activity-photos').getPublicUrl(path);

        const { error: mediaErr } = await supabase.from('activity_media').insert({
          activity_id: activityId,
          media_url: urlData.publicUrl,
          media_type: item.mediaType,
        });
        if (mediaErr) { setErrorMsg(`A photo didn't attach: ${mediaErr.message}`); continue; }

        if (item.mediaType === 'photo') {
          photoCount++;
          if (existing === 0 && photoCount === 1) {
            const { error: coverErr } = await supabase.from('activities').update({ photo_url: urlData.publicUrl }).eq('id', activityId);
            if (coverErr) setErrorMsg(`Cover photo didn't set: ${coverErr.message}`);
          }
        } else {
          videoCount++;
        }
      }

      setResults((prev) => prev!.map((r, ri) => ri === index ? { ...r, mediaCount: existing + photoCount + videoCount } : r));
    } finally {
      setUploadingIndex(null);
    }
  }

  const daysWithPhotosCount = days.filter(d => d.images.length > 0).length;
  const allDone = results && results.every(r => r.status === 'saved' || r.status === 'error');

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>

        <View style={styles.header}>
          <RivalBackButton onPress={() => (router.canGoBack() ? router.back() : router.replace('/my-activities'))} color={RivalColors.accentFill} />
        </View>

        <Text style={styles.title}>Scan Your Week</Text>
        <Text style={styles.subtitle}>Attach a photo to each day you worked out, then scan them all at once</Text>

        {/* Not tied to one specific day/field — a permission or upload
            failure from any day's photo action lands here, right above the
            day grid it's about, instead of a bar fixed over the whole
            screen (which used to sit on top of the header/back button). */}
        {errorMsg && (
          <TouchableOpacity style={styles.inlineErrorBar} onPress={() => setErrorMsg(null)}>
            <Text style={styles.floatingErrorText}>⚠️ {errorMsg}</Text>
          </TouchableOpacity>
        )}

        {!results ? (
          <>
            <View style={styles.daysGrid}>
              {days.map((day, i) => {
                const hasPhotos = day.images.length > 0;
                const isFuture = day.date.getTime() > Date.now();
                return (
                  <View key={i} style={[styles.dayCard, hasPhotos && styles.dayCardActive, isFuture && styles.dayCardDisabled]}>
                    <TouchableOpacity
                      onPress={() => isFuture
                        ? notify("Can't log a future workout", "You can only log activities for today or earlier — come back once you've actually done it!")
                        : pickPhotosForDay(i)}
                      style={styles.dayCardTouchable}
                    >
                      <Text style={[styles.dayLabel, hasPhotos && styles.dayLabelActive]}>{day.shortLabel}</Text>
                      <Text style={[styles.dayDate, hasPhotos && styles.dayLabelActive]}>{day.date.getDate()}</Text>
                      {isFuture ? (
                        <Text style={styles.dayAddIcon}>—</Text>
                      ) : hasPhotos ? (
                        <Text style={styles.dayPhotoCount}>📸 {day.images.length}</Text>
                      ) : (
                        <Text style={styles.dayAddIcon}>+</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>

            {days.some(d => d.images.length > 0) && (
              <View style={styles.thumbsSection}>
                {days.map((day, di) => day.images.length === 0 ? null : (
                  <View key={di} style={styles.thumbsRow}>
                    <Text style={styles.thumbsRowLabel}>{day.label}</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                      {day.images.map((img, ii) => (
                        <View key={ii} style={styles.thumbWrap}>
                          <Image source={{ uri: img.uri }} style={styles.thumb} />
                          <TouchableOpacity style={styles.thumbRemove} onPress={() => removeDayImage(di, ii)}>
                            <Text style={styles.thumbRemoveText}>✕</Text>
                          </TouchableOpacity>
                        </View>
                      ))}
                    </ScrollView>
                  </View>
                ))}
              </View>
            )}

            <TouchableOpacity
              style={[styles.scanAllBtn, daysWithPhotosCount === 0 && styles.scanAllBtnDisabled]}
              onPress={scanAndSaveAll}
              disabled={daysWithPhotosCount === 0 || processing}
            >
              <Text style={styles.scanAllBtnText}>
                {processing ? '⏳ Scanning…' : `Scan & Save All (${daysWithPhotosCount})`}
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <View style={styles.resultsSection}>
            {results.map((r, i) => (
              <View key={i} style={styles.resultRowCard}>
                <View style={styles.resultRowTop}>
                  <Text style={styles.resultLabel}>{r.label}</Text>
                  {r.status === 'pending' && <Text style={styles.resultStatusPending}>Waiting…</Text>}
                  {r.status === 'scanning' && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <ActivityIndicator size="small" color={RivalColors.accentFill} />
                      <Text style={styles.resultStatusPending}>Scanning…</Text>
                    </View>
                  )}
                  {r.status === 'error' && (
                    <Text style={styles.resultStatusError}>⚠️ {r.errorMsg}</Text>
                  )}
                </View>

                {r.status === 'saved' && (
                  <>
                    <View style={styles.resultSavedRow}>
                      {editingIndex === i ? (
                        <TextInput
                          style={styles.resultNameInput}
                          value={editingName}
                          onChangeText={setEditingName}
                          autoFocus
                          onSubmitEditing={() => saveEditedName(i)}
                          onBlur={() => saveEditedName(i)}
                        />
                      ) : (
                        <TouchableOpacity onPress={() => startEditingName(i, r.name || r.workoutType || '')} style={{ flex: 1 }}>
                          <Text style={styles.resultStatusSaved}>✓ {r.name} — +{r.xp} Effort ✏️</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        style={styles.resultPhotoBtn}
                        onPress={() => addPhotoToResult(i)}
                        disabled={uploadingIndex === i}
                      >
                        <Text style={styles.resultPhotoBtnText}>
                          {uploadingIndex === i ? '⏳' : `📷${r.mediaCount ? ` ${r.mediaCount}` : ''}`}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </>
                )}
              </View>
            ))}

            {allDone && (
              <TouchableOpacity style={styles.doneBtn} onPress={() => router.replace('/my-activities')}>
                <Text style={styles.doneBtnText}>View My Activities →</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: RivalColors.surfaceLow },
  content: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 40 },
  header: { marginBottom: 16 },
  back: { color: RivalColors.accentFill, fontSize: 16 },
  title: { fontSize: 32, fontWeight: '900', color: RivalColors.textPrimary, marginBottom: 6 },
  subtitle: { fontSize: 14, color: RivalColors.textSecondary, marginBottom: 24, lineHeight: 20 },

  // In normal document flow now, not position:absolute — it used to float
  // over the header/back button no matter what it was about; now it pushes
  // the day grid down instead of covering anything.
  inlineErrorBar: { backgroundColor: '#3b0a0a', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#f87171', marginBottom: 16 },
  floatingErrorText: { color: '#f87171', fontSize: 13, fontWeight: '600' },

  daysGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  dayCard: { width: '13%', minWidth: 44, aspectRatio: 0.75, backgroundColor: RivalColors.surfaceContainer, borderRadius: 12, borderWidth: 1, borderColor: RivalColors.surfaceHigh },
  dayCardActive: { backgroundColor: '#1A0A12', borderColor: RivalColors.accentFill },
  dayCardDisabled: { opacity: 0.35 },
  dayCardTouchable: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  dayLabel: { fontSize: 11, fontWeight: '700', color: RivalColors.textSecondary, textTransform: 'uppercase' },
  dayLabelActive: { color: RivalColors.accentFill },
  dayDate: { fontSize: 16, fontWeight: '800', color: RivalColors.textSecondary },
  dayAddIcon: { fontSize: 16, color: '#444444', fontWeight: '700' },
  dayPhotoCount: { fontSize: 11, fontWeight: '700', color: RivalColors.accentFill },

  thumbsSection: { gap: 14, marginBottom: 24 },
  thumbsRow: { gap: 8 },
  thumbsRowLabel: { fontSize: 13, fontWeight: '700', color: RivalColors.textSecondary },
  thumbWrap: { position: 'relative' },
  thumb: { width: 70, height: 70, borderRadius: 10, backgroundColor: RivalColors.surfaceHigh },
  thumbRemove: { position: 'absolute', top: -6, right: -6, backgroundColor: RivalColors.accentFill, borderRadius: 10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  thumbRemoveText: { color: RivalColors.textPrimary, fontSize: 11, fontWeight: '800' },

  scanAllBtn: { backgroundColor: RivalColors.accentFill, paddingVertical: 16, borderRadius: 14, alignItems: 'center' },
  scanAllBtnDisabled: { backgroundColor: '#3A2530' },
  scanAllBtnText: { color: RivalColors.textPrimary, fontSize: 16, fontWeight: '800' },

  resultsSection: { gap: 10 },
  resultRowCard: { backgroundColor: RivalColors.surfaceContainer, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: RivalColors.surfaceHigh, gap: 8 },
  resultRowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  resultSavedRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  resultNameInput: { flex: 1, backgroundColor: RivalColors.surfaceContainer, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, color: RivalColors.textPrimary, fontSize: 13, fontWeight: '700', borderWidth: 1, borderColor: RivalColors.accentFill },
  resultPhotoBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: RivalColors.surfaceHigh },
  resultPhotoBtnText: { fontSize: 13, fontWeight: '700', color: '#CCCCCC' },
  resultLabel: { fontSize: 14, fontWeight: '700', color: RivalColors.textPrimary },
  resultStatusPending: { fontSize: 13, color: RivalColors.textSecondary },
  resultStatusSaved: { fontSize: 13, color: RivalColors.accentText, fontWeight: '700' },
  resultStatusError: { fontSize: 12, color: '#f87171', fontWeight: '600' },

  doneBtn: { backgroundColor: RivalColors.accentFill, paddingVertical: 16, borderRadius: 14, alignItems: 'center', marginTop: 8 },
  doneBtnText: { color: RivalColors.textPrimary, fontSize: 16, fontWeight: '800' },
});
