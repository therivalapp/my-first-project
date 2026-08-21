import { useState, useCallback, useEffect } from 'react';
import { StyleSheet, TouchableOpacity, View, Text, ScrollView, Image, Platform, ActivityIndicator, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';
import { calculateEffortScore, loadScoringMultipliers } from '../lib/effort';
import { isoToDisplayDate, displayToIsoDate } from '../lib/dateFormat';
import { findMatchingRaceId } from '../lib/raceMatch';
import { RivalColors, RivalRadius } from '../constants/rivalTheme';

type ExtractedWorkout = {
  workoutType: string;
  duration: number;
  distance: number | null;
  elevation: number | null;
  exercises: Array<{
    name: string;
    reps?: number; sets?: number; weight?: number; distanceMeters?: number;
    prescribedReps?: number; prescribedSets?: number; prescribedWeight?: number; prescribedDistanceMeters?: number;
  }>;
  intensity: number;
  notes: string;
};

type MediaItem = { blob: Blob; uri: string; type: 'photo' | 'video'; mimeType: string; ext: string };

const TYPE_OPTIONS: Array<{ type: string; icon: string }> = [
  { type: 'Run', icon: '🏃' },
  { type: 'Ride', icon: '🚴' },
  { type: 'Swim', icon: '🏊' },
  { type: 'Rowing', icon: '🚣' },
  { type: 'WeightTraining', icon: '🏋️' },
  { type: 'CrossFit', icon: '🤸' },
  { type: 'Hyrox', icon: '🔥' },
  { type: 'HIIT', icon: '⚡' },
  { type: 'Workout', icon: '💪' },
];

// Class-based formats are almost always a full ~45-60min session even though the
// scanned WOD/board only shows the timed portion (e.g. a 15min WOD inside an hour class).
const CLASS_BASED_TYPES = new Set(['CrossFit', 'Hyrox', 'HIIT']);
const CLASS_DURATION_FLOOR_SECONDS = 45 * 60;

export const CANONICAL_LIFTS = [
  'Squat', 'Front Squat', 'Overhead Squat',
  'Bench Press', 'Incline Bench Press', 'Close Grip Bench Press',
  'Deadlift', 'Sumo Deadlift', 'Romanian Deadlift', 'Stiff Leg Deadlift',
  'Overhead Press', 'Push Press', 'Strict Press',
  'Clean', 'Power Clean', 'Hang Clean', 'Clean and Jerk',
  'Jerk', 'Push Jerk', 'Split Jerk',
  'Snatch', 'Power Snatch', 'Hang Snatch',
  // Accessory / compound lifts
  'Barbell Row', 'Pull-up', 'Dip', 'Bicep Curl', 'Hip Thrust', 'Lunge',
  'Leg Press', 'Lat Pulldown', 'Leg Curl', 'Leg Extension', 'Calf Raise',
  'Good Morning', 'Trap Bar Deadlift',
  // Variations & more accessories
  'Bulgarian Split Squat', 'Split Squat', 'Box Squat', 'Pause Squat', 'Shrug', 'Face Pull',
  'Pause Bench Press', 'Deficit Deadlift', 'Rack Pull', 'Incline Dumbbell Press',
  'Dumbbell Bench Press', 'Skullcrusher', 'Tricep Extension', 'Hammer Curl',
  'Cable Row', 'Dumbbell Row',
];

// Maps a canonical lift to every known phrasing/abbreviation that should resolve to it.
// Each alias is normalized the same way as scanned input before comparison, so
// separators (&, +, commas, hyphens) and casing don't matter.
const LIFT_ALIASES: Record<string, string[]> = {
  'Squat': ['squat', 'back squat', 'bs', 'barbell squat', 'bb squat', 'high bar squat', 'low bar squat', 'high bar back squat', 'low bar back squat'],
  'Front Squat': ['front squat', 'fs', 'barbell front squat', 'bb front squat'],
  'Overhead Squat': ['overhead squat', 'ohs', 'oh squat'],
  'Bench Press': ['bench press', 'bench', 'bb bench', 'flat bench', 'bp', 'barbell bench press', 'barbell bench', 'flat bench press', 'flat barbell bench press'],
  'Incline Bench Press': ['incline bench press', 'incline bench', 'incline bb bench', 'ibp', 'incline barbell bench press', 'incline barbell bench', 'incline press'],
  'Close Grip Bench Press': ['close grip bench press', 'close grip bench', 'cgbp', 'close grip barbell bench', 'cg bench press', 'cg bench'],
  'Deadlift': ['deadlift', 'dl', 'conventional deadlift', 'conventional dl', 'barbell deadlift', 'bb deadlift', 'conv deadlift'],
  'Sumo Deadlift': ['sumo deadlift', 'sumo dl', 'sdl', 'sumo'],
  'Romanian Deadlift': ['romanian deadlift', 'rdl', 'romanian dl'],
  'Stiff Leg Deadlift': ['stiff leg deadlift', 'sldl', 'stiff legged deadlift', 'straight leg deadlift', 'stiff leg dl'],
  'Overhead Press': ['overhead press', 'ohp', 'military press', 'strict overhead press', 'shoulder press', 'seated shoulder press', 'standing shoulder press', 'db shoulder press', 'dumbbell shoulder press', 'barbell shoulder press', 'barbell overhead press', 'bb overhead press', 'bb ohp', 'db overhead press', 'dumbbell overhead press', 'seated overhead press', 'standing overhead press'],
  'Push Press': ['push press', 'pp', 'barbell push press', 'bb push press', 'db push press', 'dumbbell push press'],
  'Strict Press': ['strict press', 'sp', 'strict shoulder press', 'strict barbell press'],
  'Clean': ['clean', 'squat clean', 'full clean', 'barbell clean', 'bb clean'],
  'Power Clean': ['power clean', 'pc'],
  'Hang Clean': ['hang clean', 'hc'],
  'Clean and Jerk': ['clean and jerk', 'clean jerk', 'c&j', 'cj', 'c j', 'cnj', 'clean n jerk'],
  'Jerk': ['jerk'],
  'Push Jerk': ['push jerk', 'pj'],
  'Split Jerk': ['split jerk', 'sj'],
  'Snatch': ['snatch', 'sn', 'squat snatch', 'full snatch', 'barbell snatch', 'bb snatch'],
  'Power Snatch': ['power snatch', 'ps'],
  'Hang Snatch': ['hang snatch', 'hsn'],
  'Barbell Row': ['barbell row', 'bb row', 'bent over row', 'bent over barbell row', 'pendlay row', 'bent row', 'bor'],
  'Pull-up': ['pull up', 'pullup', 'weighted pull up', 'weighted pullup', 'chin up', 'chinup', 'weighted chin up', 'strict pull up'],
  'Dip': ['dip', 'weighted dip', 'tricep dip', 'chest dip', 'parallel bar dip'],
  'Bicep Curl': ['bicep curl', 'biceps curl', 'barbell curl', 'bb curl', 'db curl', 'dumbbell curl', 'ez bar curl', 'ez curl', 'curl', 'dumbbell bicep curl', 'barbell bicep curl'],
  'Hip Thrust': ['hip thrust', 'barbell hip thrust', 'bb hip thrust'],
  'Lunge': ['lunge', 'walking lunge', 'db lunge', 'dumbbell lunge', 'barbell lunge', 'reverse lunge'],
  'Leg Press': ['leg press'],
  'Lat Pulldown': ['lat pulldown', 'lat pull down', 'pulldown', 'pull down', 'wide grip pulldown'],
  'Leg Curl': ['leg curl', 'hamstring curl', 'lying leg curl', 'seated leg curl'],
  'Leg Extension': ['leg extension', 'quad extension', 'knee extension'],
  'Calf Raise': ['calf raise', 'standing calf raise', 'seated calf raise'],
  'Good Morning': ['good morning', 'gm'],
  'Trap Bar Deadlift': ['trap bar deadlift', 'trap bar dl', 'hex bar deadlift', 'hex bar dl', 'trap bar', 'hex bar'],
  'Bulgarian Split Squat': ['bulgarian split squat', 'bulgarian', 'bss', 'rear foot elevated split squat', 'rfess'],
  'Split Squat': ['split squat', 'db split squat', 'dumbbell split squat', 'barbell split squat', 'bb split squat'],
  'Box Squat': ['box squat', 'bb box squat', 'barbell box squat'],
  'Pause Squat': ['pause squat', 'paused squat'],
  'Shrug': ['shrug', 'barbell shrug', 'bb shrug', 'db shrug', 'dumbbell shrug'],
  'Face Pull': ['face pull', 'cable face pull'],
  'Pause Bench Press': ['pause bench press', 'paused bench press', 'pause bench', 'paused bench'],
  'Deficit Deadlift': ['deficit deadlift', 'deficit dl'],
  'Rack Pull': ['rack pull', 'rack deadlift', 'rack dl'],
  'Incline Dumbbell Press': ['incline dumbbell press', 'incline db press', 'incline dumbbell bench press', 'incline db bench'],
  'Dumbbell Bench Press': ['dumbbell bench press', 'db bench press', 'db bench', 'dumbbell bench', 'flat db bench'],
  'Skullcrusher': ['skullcrusher', 'skull crusher', 'lying tricep extension', 'lying triceps extension', 'ez bar skullcrusher'],
  'Tricep Extension': ['tricep extension', 'triceps extension', 'overhead tricep extension', 'overhead triceps extension', 'cable tricep extension', 'overhead extension'],
  'Hammer Curl': ['hammer curl', 'db hammer curl', 'dumbbell hammer curl'],
  'Cable Row': ['cable row', 'seated cable row', 'seated row'],
  'Dumbbell Row': ['dumbbell row', 'db row', 'one arm row', 'single arm row', 'one arm dumbbell row', 'single arm dumbbell row'],
};

function normalizeLiftName(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[&+,/]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Strip a trailing plural "s" so "squats"/"deadlifts"/"cleans" match their singular
  // alias. Guarded: keep words ending in "ss" (press, cross) and short abbreviations
  // (bs, ps, ohs) untouched.
  if (base.length >= 4 && base.endsWith('s') && !base.endsWith('ss')) {
    return base.slice(0, -1);
  }
  return base;
}

const LIFT_ALIAS_LOOKUP: Record<string, string> = Object.entries(LIFT_ALIASES)
  .reduce((map, [canonical, aliases]) => {
    for (const alias of aliases) map[normalizeLiftName(alias)] = canonical;
    return map;
  }, {} as Record<string, string>);

export function matchCanonicalLift(name: string): string | null {
  return LIFT_ALIAS_LOOKUP[normalizeLiftName(name)] ?? null;
}

function dateToLocalStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Matches races.tsx's finish-time parser — typed directly as "1:31:25" (h:mm:ss) or "31:25" (mm:ss).
function parseTimeToSeconds(t: string): number {
  const parts = t.trim().split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

function todayLocalStr(): string {
  return dateToLocalStr(new Date());
}

function applyClassDurationFloor(workoutType: string, durationSeconds: number): number {
  if (CLASS_BASED_TYPES.has(workoutType) && durationSeconds > 0 && durationSeconds < 30 * 60) {
    return CLASS_DURATION_FLOOR_SECONDS;
  }
  return durationSeconds;
}

export default function ScanWorkoutScreen() {
  const [scanImages, setScanImages] = useState<Array<{ uri: string; aspectRatio: number }>>([]);
  const [extraMedia, setExtraMedia] = useState<MediaItem[]>([]);
  const [extractedWorkout, setExtractedWorkout] = useState<ExtractedWorkout | null>(null);
  const [userNotes, setUserNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [mediaErrorMsg, setMediaErrorMsg] = useState<string | null>(null);
  // Decoupled from extractedWorkout.distance (a number) so typing "42." doesn't
  // immediately snap back to "42" — Number("42.") === 42, and a controlled input
  // whose value is re-derived from the parsed number on every keystroke can never
  // hold a trailing "." or trailing zeros while the user is still typing.
  const [distanceText, setDistanceText] = useState('');
  // Same decoupling for duration, typed directly as "1:31:25" (h:mm:ss) rather than
  // a separate minutes field + read-only preview — matches the finish-time input on races.tsx.
  const [durationText, setDurationText] = useState('');

  useEffect(() => {
    const current = distanceText.trim() === '' ? null : Number(distanceText);
    if (extractedWorkout?.distance !== current) {
      setDistanceText(extractedWorkout?.distance != null ? String(extractedWorkout.distance) : '');
    }
    // Only re-sync from extractedWorkout — distanceText itself is the typing source of truth.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extractedWorkout?.distance]);

  useEffect(() => {
    const current = parseTimeToSeconds(durationText);
    if (extractedWorkout?.duration !== current) {
      setDurationText(extractedWorkout?.duration ? formatDurationHMS(extractedWorkout.duration) : '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extractedWorkout?.duration]);

  useEffect(() => {
    if (!errorMsg) return;
    const t = setTimeout(() => setErrorMsg(null), 5000);
    return () => clearTimeout(t);
  }, [errorMsg]);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [savedActivityId, setSavedActivityId] = useState<string | null>(null);
  const [savedHasPhoto, setSavedHasPhoto] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [workoutName, setWorkoutName] = useState('');
  const [weightUnit, setWeightUnit] = useState<'kg' | 'lb'>('kg');
  const [distanceUnit, setDistanceUnit] = useState<'m' | 'mi'>('m');
  const [liftTags, setLiftTags] = useState<Record<number, string>>({});
  const [tagPickerIndex, setTagPickerIndex] = useState<number | null>(null);
  const [nameSuggestIndex, setNameSuggestIndex] = useState<number | null>(null);
  const [tagSearch, setTagSearch] = useState('');
  const [activityDateStr, setActivityDateStr] = useState(() => isoToDisplayDate(todayLocalStr()));
  const [editActivityId, setEditActivityId] = useState<string | null>(null);
  const [editOriginalStartedAt, setEditOriginalStartedAt] = useState<string | null>(null);
  const [loadingEdit, setLoadingEdit] = useState(false);

  const { activityId: editParamId, mode: entryMode, source: entrySource } = useLocalSearchParams<{ activityId?: string; mode?: string; source?: string }>();

  // Entry-point params from the Add Workout hub. `mode=manual` jumps straight
  // into the manual-entry form; `source=camera|gallery` best-effort auto-opens
  // the picker (native always works; on web the browser may require a tap, in
  // which case the upload buttons are right there as a fallback). Runs once.
  useEffect(() => {
    if (editParamId) return;
    if (entryMode === 'manual') { startManualEntry(); return; }
    if (entrySource === 'camera' || entrySource === 'gallery') { pickImage(entrySource); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!editParamId) return;
    setLoadingEdit(true);
    (async () => {
      const { data: activity, error } = await supabase
        .from('activities')
        .select('id, name, activity_type, started_at, duration_seconds, distance_meters, elevation_meters, notes, exercises')
        .eq('id', editParamId)
        .single();
      setLoadingEdit(false);
      if (error || !activity) {
        setErrorMsg('Could not load that activity to edit');
        return;
      }
      setEditActivityId(activity.id);
      setEditOriginalStartedAt(activity.started_at);
      setActivityDateStr(isoToDisplayDate(dateToLocalStr(new Date(activity.started_at))));
      setWorkoutName(activity.name || activity.activity_type);
      setUserNotes(activity.notes || '');
      const exercises = (activity.exercises || []) as ExtractedWorkout['exercises'];
      const tags: Record<number, string> = {};
      exercises.forEach((ex: any, i: number) => { if (ex.prLift) tags[i] = ex.prLift; });
      setLiftTags(tags);
      setExtractedWorkout({
        workoutType: activity.activity_type,
        duration: activity.duration_seconds || 0,
        distance: activity.distance_meters ? activity.distance_meters / 1000 : null,
        elevation: activity.elevation_meters || null,
        exercises,
        intensity: 50,
        notes: activity.notes || '',
      });
    })();
  }, [editParamId]);

  const KG_PER_LB = 0.453592;
  const M_PER_MI = 1609.34;

  function kgToDisplay(kg: number | undefined): string {
    if (kg == null) return '';
    const val = weightUnit === 'lb' ? kg / KG_PER_LB : kg;
    return String(Math.round(val * 10) / 10);
  }

  function displayToKg(value: string): number | undefined {
    if (value.trim() === '') return undefined;
    const num = Number(value);
    return weightUnit === 'lb' ? num * KG_PER_LB : num;
  }

  function metersToDisplay(m: number | undefined): string {
    if (m == null) return '';
    const val = distanceUnit === 'mi' ? m / M_PER_MI : m;
    return String(Math.round(val * 100) / 100);
  }

  function displayToMeters(value: string): number | undefined {
    if (value.trim() === '') return undefined;
    const num = Number(value);
    return distanceUnit === 'mi' ? num * M_PER_MI : num;
  }

  function resetForNewImage() {
    setExtraMedia([]);
    setExtractedWorkout(null);
    setWorkoutName('');
    setUserNotes('');
    setErrorMsg(null);
    setSuccessMsg(null);
    setActivityDateStr(isoToDisplayDate(todayLocalStr()));
    setEditActivityId(null);
    setEditOriginalStartedAt(null);
    setLiftTags({});
  }

  function startManualEntry() {
    resetForNewImage();
    setExtractedWorkout({
      workoutType: 'Workout',
      duration: 0,
      distance: null,
      elevation: null,
      exercises: [],
      intensity: 50,
      notes: '',
    });
    setWorkoutName('');
  }

  async function pickImage(source: 'camera' | 'gallery') {
    if (Platform.OS === 'web') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.multiple = true;
      input.onchange = async () => {
        const files = Array.from(input.files || []);
        if (files.length === 0) return;

        resetForNewImage();

        const readFile = (file: File) => new Promise<{ dataUri: string; base64: string; mimeType: string; w: number; h: number }>((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            const dataUri = e.target?.result as string;
            const base64 = dataUri.split(',')[1];
            const mimeType = file.type || 'image/jpeg';
            const img = document.createElement('img');
            img.onload = () => resolve({ dataUri, base64, mimeType, w: img.naturalWidth, h: img.naturalHeight });
            img.onerror = () => resolve({ dataUri, base64, mimeType, w: 1, h: 1 });
            img.src = dataUri;
          };
          reader.readAsDataURL(file);
        });

        const results = await Promise.all(files.map(readFile));
        setScanImages(results.map(r => ({ uri: r.dataUri, aspectRatio: r.w / r.h })));

        await analyzeImages(results.map(r => ({ base64Image: r.base64, mediaType: r.mimeType })));
      };
      input.click();
      return;
    }

    // Native (iOS/Android)
    const permission = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      setErrorMsg(source === 'camera' ? 'Camera access is needed to take a photo' : 'Photo library access is needed to upload a photo');
      return;
    }

    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8, base64: true })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8, base64: true, allowsMultipleSelection: true });

    if (result.canceled || !result.assets?.length) return;

    resetForNewImage();

    setScanImages(result.assets.map(a => ({
      uri: a.uri,
      aspectRatio: a.width && a.height ? a.width / a.height : 1,
    })));

    const imagesForAnalysis = result.assets
      .filter(a => a.base64)
      .map(a => ({ base64Image: a.base64!, mediaType: a.mimeType || 'image/jpeg' }));

    if (imagesForAnalysis.length > 0) {
      await analyzeImages(imagesForAnalysis);
    } else {
      setErrorMsg('Could not read the photo. Try again.');
    }
  }

  const MAX_PHOTOS = 2;
  const MAX_VIDEOS = 1;
  const MAX_PHOTO_MB = 15;
  const MAX_VIDEO_MB = 50;

  function checkMediaLimits(
    type: 'photo' | 'video',
    sizeMb: number,
    photoCount: number,
    videoCount: number
  ): string | null {
    if (type === 'video' && sizeMb > MAX_VIDEO_MB) return `Video too large (max ${MAX_VIDEO_MB}MB)`;
    if (type === 'photo' && sizeMb > MAX_PHOTO_MB) return `Photo too large (max ${MAX_PHOTO_MB}MB)`;
    if (type === 'photo' && photoCount >= MAX_PHOTOS) return `Max ${MAX_PHOTOS} photos per workout`;
    if (type === 'video' && videoCount >= MAX_VIDEOS) return `Max ${MAX_VIDEOS} video per workout`;
    return null;
  }

  function pickExtraMedia() {
    if (Platform.OS === 'web') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*,video/*';
      input.multiple = true;
      input.onchange = () => {
        const files = Array.from(input.files || []);
        setMediaErrorMsg(null);
        setExtraMedia((prev) => {
          let photoCount = 0;
          let videoCount = 0;
          prev.forEach((m) => (m.type === 'video' ? videoCount++ : photoCount++));

          const accepted: MediaItem[] = [];
          for (const file of files) {
            const type: 'photo' | 'video' = file.type.startsWith('video') ? 'video' : 'photo';
            const sizeMb = file.size / (1024 * 1024);
            const rejection = checkMediaLimits(type, sizeMb, photoCount, videoCount);
            if (rejection) { setMediaErrorMsg(rejection); continue; }

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

    // Native (iOS/Android)
    pickExtraMediaNative();
  }

  async function pickExtraMediaNative() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setMediaErrorMsg('Photo library access is needed to add photos/videos');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: true,
      quality: 0.8,
    });

    if (result.canceled || !result.assets?.length) return;
    setMediaErrorMsg(null);

    let photoCount = extraMedia.filter((m) => m.type === 'photo').length;
    let videoCount = extraMedia.filter((m) => m.type === 'video').length;

    const accepted: MediaItem[] = [];
    for (const asset of result.assets) {
      const type: 'photo' | 'video' = asset.type === 'video' ? 'video' : 'photo';
      const blob = await (await fetch(asset.uri)).blob();
      const sizeMb = blob.size / (1024 * 1024);
      const rejection = checkMediaLimits(type, sizeMb, photoCount, videoCount);
      if (rejection) { setMediaErrorMsg(rejection); continue; }

      const mimeType = asset.mimeType || (type === 'video' ? 'video/mp4' : 'image/jpeg');
      const ext = asset.fileName?.split('.').pop() || (type === 'video' ? 'mp4' : 'jpg');
      accepted.push({ blob, uri: asset.uri, type, mimeType, ext });
      if (type === 'video') videoCount++; else photoCount++;
    }

    setExtraMedia((prev) => [...prev, ...accepted]);
  }

  function removeExtraMedia(index: number) {
    setExtraMedia((prev) => prev.filter((_, i) => i !== index));
  }

  async function analyzeImages(images: Array<{ base64Image: string; mediaType: string }>) {
    setAnalyzing(true);
    setErrorMsg(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/scan-workout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
        },
        body: JSON.stringify({ images }),
      });

      const data = await response.json();

      if (!response.ok || !data.workout) {
        setErrorMsg(data.error || 'Could not read the workout image. Try a clearer photo.');
        return;
      }

      const detectedType = data.workout.workoutType || 'Workout';
      setExtractedWorkout({
        workoutType: detectedType,
        duration: applyClassDurationFloor(detectedType, data.workout.duration || 0),
        distance: data.workout.distance ?? null,
        elevation: data.workout.elevation ?? null,
        exercises: data.workout.exercises || [],
        intensity: data.workout.intensity ?? 50,
        notes: data.workout.notes || '',
      });
      setWorkoutName(data.workout.workoutType || 'Workout');
    } catch (err) {
      console.error('Analysis failed:', err);
      setErrorMsg('Could not read the workout image. Try a clearer photo.');
    } finally {
      setAnalyzing(false);
    }
  }

  function getPrescribedComparisons(ex: ExtractedWorkout['exercises'][number], index: number) {
    // Only compare against a genuine Rx standard the AI detected in the photo itself —
    // never against the originally-scanned value, otherwise correcting an AI mistake
    // (e.g. Bike misread as Row) gets mislabeled as "scaling".
    const comparisons: Array<{ label: string; wentAbove: boolean }> = [];

    if (ex.prescribedWeight != null && ex.weight != null && ex.prescribedWeight !== ex.weight) {
      const above = ex.weight > ex.prescribedWeight;
      comparisons.push({
        label: above
          ? `🔥 ${kgToDisplay(ex.weight)}${weightUnit} weight — went above Rx`
          : `💪 Scaled to ${kgToDisplay(ex.weight)}${weightUnit} weight`,
        wentAbove: above,
      });
    }

    if (ex.prescribedReps != null && ex.reps != null && ex.prescribedReps !== ex.reps) {
      const above = ex.reps > ex.prescribedReps;
      comparisons.push({
        label: above ? `🔥 ${ex.reps} reps — went above Rx` : `💪 Scaled to ${ex.reps} reps`,
        wentAbove: above,
      });
    }

    if (ex.prescribedSets != null && ex.sets != null && ex.prescribedSets !== ex.sets) {
      const above = ex.sets > ex.prescribedSets;
      comparisons.push({
        label: above ? `🔥 ${ex.sets} sets — went above Rx` : `💪 Scaled to ${ex.sets} sets`,
        wentAbove: above,
      });
    }

    if (ex.prescribedDistanceMeters != null && ex.distanceMeters != null && ex.prescribedDistanceMeters !== ex.distanceMeters) {
      const above = ex.distanceMeters > ex.prescribedDistanceMeters;
      comparisons.push({
        label: above
          ? `🔥 ${metersToDisplay(ex.distanceMeters)}${distanceUnit} — went above Rx`
          : `💪 Scaled to ${metersToDisplay(ex.distanceMeters)}${distanceUnit}`,
        wentAbove: above,
      });
    }

    return comparisons;
  }

  function updateExercise(index: number, field: 'sets' | 'reps' | 'weight' | 'distanceMeters', value: string) {
    if (!extractedWorkout) return;
    const num = value.trim() === '' ? undefined : Number(value);
    const updatedExercises = extractedWorkout.exercises.map((ex, i) =>
      i === index ? { ...ex, [field]: num } : ex
    );
    setExtractedWorkout({ ...extractedWorkout, exercises: updatedExercises });
  }

  function updateExerciseName(index: number, value: string) {
    if (!extractedWorkout) return;
    const updatedExercises = extractedWorkout.exercises.map((ex, i) =>
      i === index ? { ...ex, name: value } : ex
    );
    setExtractedWorkout({ ...extractedWorkout, exercises: updatedExercises });
  }

  // Canonical-lift suggestions for the name field: match the typed text against each
  // canonical lift's name and its aliases, so "shoulder" surfaces "Overhead Press".
  // Returns [] once the name already resolves exactly to a canonical lift.
  function liftSuggestions(input: string): string[] {
    const q = normalizeLiftName(input || '');
    if (!q || matchCanonicalLift(input)) return [];
    return CANONICAL_LIFTS.filter((lift) =>
      normalizeLiftName(lift).includes(q) ||
      (LIFT_ALIASES[lift] || []).some((a) => normalizeLiftName(a).includes(q))
    ).slice(0, 6);
  }

  // Full canonical-lift filter for the searchable tag picker (empty query = all).
  function filterCanonicalLifts(query: string): string[] {
    const q = normalizeLiftName(query || '');
    if (!q) return CANONICAL_LIFTS;
    return CANONICAL_LIFTS.filter((lift) =>
      normalizeLiftName(lift).includes(q) ||
      (LIFT_ALIASES[lift] || []).some((a) => normalizeLiftName(a).includes(q))
    );
  }

  function addExercise() {
    if (!extractedWorkout) return;
    setExtractedWorkout({
      ...extractedWorkout,
      exercises: [...extractedWorkout.exercises, { name: '' }],
    });
  }

  function removeExercise(index: number) {
    if (!extractedWorkout) return;
    setExtractedWorkout({
      ...extractedWorkout,
      exercises: extractedWorkout.exercises.filter((_, i) => i !== index),
    });
    setLiftTags((prev) => {
      const next: Record<number, string> = {};
      for (const [k, v] of Object.entries(prev)) {
        const i = Number(k);
        if (i < index) next[i] = v;
        else if (i > index) next[i - 1] = v;
      }
      return next;
    });
    if (tagPickerIndex === index) setTagPickerIndex(null);
  }

  async function saveWorkout() {
    if (!extractedWorkout || !workoutName?.trim()) {
      setErrorMsg('Please enter a workout name');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const durationMinutes = extractedWorkout.duration / 60;
      const effortScore = calculateEffortScore(
        extractedWorkout.workoutType,
        extractedWorkout.duration,
        extractedWorkout.distance || 0,
        await loadScoringMultipliers(),
        extractedWorkout.intensity
      );

      const isoDate = displayToIsoDate(activityDateStr);
      if (!isoDate) {
        setErrorMsg('Please enter the date as DD/MM/YYYY');
        setLoading(false);
        return;
      }
      const [y, m, d] = isoDate.split('-').map(Number);
      const reference = editOriginalStartedAt ? new Date(editOriginalStartedAt) : new Date();
      const startedAt = new Date(y, m - 1, d, reference.getHours(), reference.getMinutes(), reference.getSeconds());

      const exercisesPayload = extractedWorkout.exercises.length > 0
        ? extractedWorkout.exercises.map((ex, i) => liftTags[i] ? { ...ex, prLift: liftTags[i] } : ex)
        : null;

      const raceId = await findMatchingRaceId(user.id, startedAt.toISOString());

      const activityPayload = {
        user_id: user.id,
        name: workoutName,
        activity_type: extractedWorkout.workoutType,
        distance_meters: extractedWorkout.distance ? extractedWorkout.distance * 1000 : 0,
        duration_seconds: extractedWorkout.duration,
        elevation_meters: extractedWorkout.elevation || 0,
        started_at: startedAt.toISOString(),
        effort_score: effortScore,
        raw_effort_score: effortScore,
        notes: userNotes.trim() || null,
        exercises: exercisesPayload,
        race_id: raceId,
      };

      let activityId: string;
      if (editActivityId) {
        const { error } = await supabase.from('activities').update(activityPayload).eq('id', editActivityId);
        if (error) {
          setErrorMsg(error.message.includes('activities_started_at_not_future')
            ? "That date is in the future — activities can't be logged ahead of time."
            : `Save failed: ${error.message}`);
          return;
        }
        activityId = editActivityId;
        // If the old rows can't be cleared, re-inserting below would DOUBLE the
        // athlete's lifts for this workout and corrupt their PR history, so stop
        // rather than press on.
        const { error: clearErr } = await supabase.from('exercise_entries').delete().eq('activity_id', activityId);
        if (clearErr) {
          setErrorMsg(`Couldn't update your lifts: ${clearErr.message}`);
          return;
        }
      } else {
        const { data: inserted, error } = await supabase
          .from('activities')
          .insert({ ...activityPayload, provider: 'rival_scan', provider_activity_id: `scan-${Date.now()}` })
          .select('id')
          .single();

        if (error || !inserted) {
          setErrorMsg(error?.message?.includes('activities_started_at_not_future')
            ? "That date is in the future — activities can't be logged ahead of time."
            : `Save failed: ${error?.message ?? 'unknown error'}`);
          return;
        }
        activityId = inserted.id;
      }

      const liftEntries = extractedWorkout.exercises
        .map((ex, i) => ({
          user_id: user.id,
          activity_id: activityId,
          // Use the canonical name when we recognise the lift (so it groups with
          // existing PR history); otherwise fall back to the user's own name,
          // title-cased. Previously non-canonical lifts were dropped entirely, so
          // manually-entered lifts (e.g. "shoulder press") never reached the PR tracker.
          exercise_name: matchCanonicalLift(ex.name) || liftTags[i]
            || (ex.name ? ex.name.trim().replace(/\b\w/g, c => c.toUpperCase()) : null),
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
        if (liftErr) setErrorMsg(`Workout saved, but the lifts didn't attach: ${liftErr.message}`);
      }

      // Only photos/videos added in the "Photos & Videos" section get stored and shown
      // in the feed — the workout-data scan photos are used for AI extraction only.
      let firstPhotoUrl: string | null = null;

      for (let i = 0; i < extraMedia.length; i++) {
        const item = extraMedia[i];
        const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const path = `${user.id}/${activityId}-${uniqueId}.${item.ext}`;

        const { error: storageErr } = await supabase.storage
          .from('activity-photos')
          .upload(path, item.blob, { contentType: item.mimeType, upsert: true });

        if (storageErr) {
          console.error('Media upload failed:', storageErr.message);
          continue;
        }

        const { data: urlData } = supabase.storage.from('activity-photos').getPublicUrl(path);

        const { error: mediaErr } = await supabase.from('activity_media').insert({
          activity_id: activityId,
          media_url: urlData.publicUrl,
          media_type: item.type,
        });
        if (mediaErr) { console.error('Media row insert failed:', mediaErr.message); continue; }

        if (item.type === 'photo' && !firstPhotoUrl) {
          firstPhotoUrl = urlData.publicUrl;
        }
      }

      if (firstPhotoUrl) {
        const { error: coverErr } = await supabase.from('activities').update({ photo_url: firstPhotoUrl }).eq('id', activityId);
        if (coverErr) setErrorMsg(`Workout saved, but the cover photo didn't set: ${coverErr.message}`);
      }

      setSuccessMsg(`${workoutName} saved with ${Math.round(effortScore)} Effort!`);
      setSavedActivityId(activityId);
      setSavedHasPhoto(!!firstPhotoUrl);
      // Check milestones fire-and-forget
      const { data: { session: ms } } = await supabase.auth.getSession();
      if (ms) fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/check-milestones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ms.access_token}`, 'apikey': process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY! },
      }).catch(() => {});
      // If they added a photo, let them AI-enhance it before leaving; otherwise
      // head back to the feed automatically.
      if (!firstPhotoUrl) setTimeout(() => router.replace('/my-activities'), 1200);
    } catch (err) {
      console.error('Save failed:', err);
      setErrorMsg('Failed to save workout');
    } finally {
      setLoading(false);
    }
  }

  function formatDurationHMS(totalSeconds: number): string {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.floor(totalSeconds % 60);
    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  return (
    <SafeAreaView style={styles.container}>
      {errorMsg && (
        <TouchableOpacity style={styles.floatingErrorBar} onPress={() => setErrorMsg(null)}>
          <Text style={styles.floatingErrorText}>⚠️ {errorMsg}</Text>
        </TouchableOpacity>
      )}
      <ScrollView contentContainerStyle={styles.content}>

        <View style={styles.header}>
          <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/my-activities'))}>
            <Text style={styles.back}>← Back</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.title}>{editActivityId ? 'Edit Activity' : 'Scan Workout'}</Text>
        {loadingEdit && <Text style={styles.subtitle}>Loading…</Text>}

        {successMsg && (
          <View style={styles.successBanner}>
            <Text style={styles.successBannerText}>✓ {successMsg}</Text>
            {savedActivityId && savedHasPhoto && (
              <View style={styles.enhanceCta}>
                <TouchableOpacity
                  style={styles.enhanceBtn}
                  onPress={() => router.replace(`/ai-share?activityId=${savedActivityId}`)}
                >
                  <Text style={styles.enhanceBtnText}>✨ AI Enhance your photo</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => router.replace('/my-activities')}>
                  <Text style={styles.enhanceDoneText}>Done</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {scanImages.length === 0 && !extractedWorkout && !editParamId ? (
          <View style={styles.uploadArea}>
            <Text style={styles.uploadIcon}>📸</Text>
            <Text style={styles.uploadTitle}>Add Your Workout</Text>
            <Text style={styles.uploadSub}>
              Photo from your training app, gym whiteboard, or workout card — select multiple if your workout spans a few photos
            </Text>

            <View style={styles.howItWorksCard}>
              <Text style={styles.howItWorksTitle}>How it works</Text>
              <View style={styles.howItWorksRow}>
                <Text style={styles.howItWorksNum}>1</Text>
                <Text style={styles.howItWorksText}>Upload one or more photos of a single workout (multiple photos help — different days need separate scans)</Text>
              </View>
              <View style={styles.howItWorksRow}>
                <Text style={styles.howItWorksNum}>2</Text>
                <Text style={styles.howItWorksText}>AI reads it and fills in the details</Text>
              </View>
              <View style={styles.howItWorksRow}>
                <Text style={styles.howItWorksNum}>3</Text>
                <Text style={styles.howItWorksText}>Review and save — Effort updates instantly</Text>
              </View>
            </View>

            <View style={styles.buttonRow}>
              <TouchableOpacity style={styles.uploadBtn} onPress={() => pickImage('camera')}>
                <Text style={styles.uploadBtnText}>📷 Take Photo</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.uploadBtn} onPress={() => pickImage('gallery')}>
                <Text style={styles.uploadBtnText}>📁 Upload</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.manualEntryBtn} onPress={() => router.push('/manual-entry')}>
              <Text style={styles.manualEntryBtnText}>✏️ Enter Workout Manually</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.weekScanLinkBtn} onPress={() => router.push('/weekly-scan')}>
              <Text style={styles.weekScanLinkBtnText}>📅 Got a whole week to log? Scan multiple days at once</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.previewSection}>
            {scanImages.length === 1 && (
              <Image source={{ uri: scanImages[0].uri }} style={[styles.image, { aspectRatio: scanImages[0].aspectRatio }]} resizeMode="contain" />
            )}
            {scanImages.length > 1 && (
              <View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scanImagesRow}>
                  {scanImages.map((img, i) => (
                    <Image key={i} source={{ uri: img.uri }} style={styles.scanImageThumb} resizeMode="cover" />
                  ))}
                </ScrollView>
                <Text style={styles.scanImagesHint}>{scanImages.length} photos combined into this workout</Text>
              </View>
            )}

            {analyzing ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color={RivalColors.accentFill} size="large" />
                <Text style={styles.loadingText}>Reading your workout...</Text>
              </View>
            ) : extractedWorkout ? (
              <View style={styles.extractedBox}>
                <Text style={styles.extractedLabel}>Workout Details</Text>

                <View style={styles.typeFieldBox}>
                  <Text style={styles.fieldLabel}>Type</Text>
                  <View style={styles.typeChipRow}>
                    {TYPE_OPTIONS.map((opt) => {
                      const selected = extractedWorkout.workoutType === opt.type;
                      return (
                        <TouchableOpacity
                          key={opt.type}
                          style={[styles.typeChip, selected && styles.typeChipSelected]}
                          onPress={() => setExtractedWorkout({
                            ...extractedWorkout,
                            workoutType: opt.type,
                            duration: applyClassDurationFloor(opt.type, extractedWorkout.duration),
                          })}
                        >
                          <Text style={styles.typeChipIcon}>{opt.icon}</Text>
                          <Text style={[styles.typeChipText, selected && styles.typeChipTextSelected]}>{opt.type}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                <View style={styles.fieldRow}>
                  <Text style={styles.fieldLabel}>Duration:</Text>
                  <TextInput
                    style={styles.fieldValueInput}
                    value={durationText}
                    onChangeText={(v) => {
                      setDurationText(v);
                      setExtractedWorkout({ ...extractedWorkout, duration: parseTimeToSeconds(v) });
                    }}
                    placeholder="e.g. 1:31:25"
                    placeholderTextColor={RivalColors.textSecondary}
                    autoCapitalize="none"
                  />
                </View>
                {CLASS_BASED_TYPES.has(extractedWorkout.workoutType) && (
                  <Text style={styles.classDurationHint}>
                    CrossFit/Hyrox/HIIT classes usually run 45-60 min total — make sure this includes warm-up & skill work, not just the timed WOD.
                  </Text>
                )}

                <View style={styles.fieldRow}>
                  <Text style={styles.fieldLabel}>Distance (km):</Text>
                  <TextInput
                    style={styles.fieldValueInput}
                    value={distanceText}
                    onChangeText={(v) => {
                      setDistanceText(v);
                      const km = v.trim() === '' ? null : Number(v);
                      if (!Number.isNaN(km)) setExtractedWorkout({ ...extractedWorkout, distance: km });
                    }}
                    placeholder="0"
                    placeholderTextColor={RivalColors.textSecondary}
                    keyboardType="decimal-pad"
                  />
                </View>

                <View style={styles.fieldRow}>
                  <Text style={styles.fieldLabel}>Elevation (m):</Text>
                  <TextInput
                    style={styles.fieldValueInput}
                    value={extractedWorkout.elevation != null ? String(extractedWorkout.elevation) : ''}
                    onChangeText={(v) => {
                      const m = v.trim() === '' ? null : Number(v);
                      setExtractedWorkout({ ...extractedWorkout, elevation: m });
                    }}
                    placeholder="0"
                    placeholderTextColor={RivalColors.textSecondary}
                    keyboardType="numeric"
                  />
                </View>

                {(
                  <View style={styles.exercisesBox}>
                    <View style={styles.exercisesHeaderRow}>
                      <Text style={styles.exercisesLabel}>Exercises ({extractedWorkout.exercises.length})</Text>
                      <View style={styles.unitTogglesRow}>
                        <View style={styles.unitToggle}>
                          <TouchableOpacity
                            style={[styles.unitToggleBtn, weightUnit === 'kg' && styles.unitToggleBtnActive]}
                            onPress={() => setWeightUnit('kg')}
                          >
                            <Text style={[styles.unitToggleText, weightUnit === 'kg' && styles.unitToggleTextActive]}>kg</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.unitToggleBtn, weightUnit === 'lb' && styles.unitToggleBtnActive]}
                            onPress={() => setWeightUnit('lb')}
                          >
                            <Text style={[styles.unitToggleText, weightUnit === 'lb' && styles.unitToggleTextActive]}>lb</Text>
                          </TouchableOpacity>
                        </View>
                        <View style={styles.unitToggle}>
                          <TouchableOpacity
                            style={[styles.unitToggleBtn, distanceUnit === 'm' && styles.unitToggleBtnActive]}
                            onPress={() => setDistanceUnit('m')}
                          >
                            <Text style={[styles.unitToggleText, distanceUnit === 'm' && styles.unitToggleTextActive]}>m</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.unitToggleBtn, distanceUnit === 'mi' && styles.unitToggleBtnActive]}
                            onPress={() => setDistanceUnit('mi')}
                          >
                            <Text style={[styles.unitToggleText, distanceUnit === 'mi' && styles.unitToggleTextActive]}>mi</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>

                    {extractedWorkout.exercises.map((ex, i) => {
                      const comparisons = getPrescribedComparisons(ex, i);
                      return (
                        <View key={i} style={styles.exerciseEditRow}>
                          <View style={styles.exerciseNameRow}>
                            <TextInput
                              style={[styles.exerciseNameInput, { flex: 1 }]}
                              value={ex.name}
                              onChangeText={(v) => updateExerciseName(i, v)}
                              onFocus={() => setNameSuggestIndex(i)}
                              onBlur={() => setTimeout(() => setNameSuggestIndex((cur) => (cur === i ? null : cur)), 150)}
                              placeholder="Exercise name"
                              placeholderTextColor={RivalColors.textSecondary}
                            />
                            <TouchableOpacity style={styles.removeExerciseBtn} onPress={() => removeExercise(i)}>
                              <Text style={styles.removeExerciseBtnText}>✕</Text>
                            </TouchableOpacity>
                          </View>
                          {nameSuggestIndex === i && liftSuggestions(ex.name).length > 0 && (
                            <View style={styles.nameSuggestBox}>
                              {liftSuggestions(ex.name).map((s) => (
                                <TouchableOpacity
                                  key={s}
                                  style={styles.nameSuggestItem}
                                  onPress={() => { updateExerciseName(i, s); setNameSuggestIndex(null); }}
                                >
                                  <Text style={styles.nameSuggestText}>{s}</Text>
                                  <Text style={styles.nameSuggestHint}>PB tracked</Text>
                                </TouchableOpacity>
                              ))}
                            </View>
                          )}
                          <View style={styles.exerciseFieldsRow}>
                            <View style={styles.exerciseFieldBox}>
                              <Text style={styles.exerciseFieldLabel}>Sets</Text>
                              <TextInput
                                style={styles.exerciseFieldInput}
                                value={ex.sets != null ? String(ex.sets) : ''}
                                onChangeText={(v) => updateExercise(i, 'sets', v)}
                                placeholder="-"
                                placeholderTextColor={RivalColors.textSecondary}
                                keyboardType="numeric"
                              />
                            </View>
                            <View style={styles.exerciseFieldBox}>
                              <Text style={styles.exerciseFieldLabel}>Reps</Text>
                              <TextInput
                                style={styles.exerciseFieldInput}
                                value={ex.reps != null ? String(ex.reps) : ''}
                                onChangeText={(v) => updateExercise(i, 'reps', v)}
                                placeholder="-"
                                placeholderTextColor={RivalColors.textSecondary}
                                keyboardType="numeric"
                              />
                            </View>
                            <View style={styles.exerciseFieldBox}>
                              <Text style={styles.exerciseFieldLabel} numberOfLines={1}>Weight ({weightUnit})</Text>
                              <TextInput
                                style={styles.exerciseFieldInput}
                                value={kgToDisplay(ex.weight)}
                                onChangeText={(v) => {
                                  if (!extractedWorkout) return;
                                  const kg = displayToKg(v);
                                  const updated = extractedWorkout.exercises.map((e, idx) =>
                                    idx === i ? { ...e, weight: kg } : e
                                  );
                                  setExtractedWorkout({ ...extractedWorkout, exercises: updated });
                                }}
                                placeholder="-"
                                placeholderTextColor={RivalColors.textSecondary}
                                keyboardType="numeric"
                              />
                            </View>
                            <View style={styles.exerciseFieldBox}>
                              <Text style={styles.exerciseFieldLabel} numberOfLines={1}>Distance ({distanceUnit})</Text>
                              <TextInput
                                style={styles.exerciseFieldInput}
                                value={metersToDisplay(ex.distanceMeters)}
                                onChangeText={(v) => {
                                  if (!extractedWorkout) return;
                                  const meters = displayToMeters(v);
                                  const updated = extractedWorkout.exercises.map((e, idx) =>
                                    idx === i ? { ...e, distanceMeters: meters } : e
                                  );
                                  setExtractedWorkout({ ...extractedWorkout, exercises: updated });
                                }}
                                placeholder="-"
                                placeholderTextColor={RivalColors.textSecondary}
                                keyboardType="numeric"
                              />
                            </View>
                          </View>

                          {matchCanonicalLift(ex.name) ? (
                            <Text style={styles.liftAutoTrackedText}>✓ PB tracked as {matchCanonicalLift(ex.name)}</Text>
                          ) : liftTags[i] ? (
                            <View style={styles.liftTagChip}>
                              <Text style={styles.liftTagChipText}>🏷️ PB tracked as {liftTags[i]}</Text>
                              <TouchableOpacity onPress={() => setLiftTags((prev) => { const next = { ...prev }; delete next[i]; return next; })}>
                                <Text style={styles.liftTagRemove}>✕</Text>
                              </TouchableOpacity>
                            </View>
                          ) : (
                            <TouchableOpacity
                              style={styles.tagLiftBtn}
                              onPress={() => { setTagSearch(''); setTagPickerIndex(tagPickerIndex === i ? null : i); }}
                            >
                              <Text style={styles.tagLiftBtnText}>🏷️ Tag a lift PB from this exercise</Text>
                            </TouchableOpacity>
                          )}

                          {tagPickerIndex === i && (
                            <View style={styles.liftPickerBox}>
                              <TextInput
                                style={styles.liftSearchInput}
                                value={tagSearch}
                                onChangeText={setTagSearch}
                                placeholder="Search lifts…"
                                placeholderTextColor={RivalColors.textSecondary}
                                autoFocus
                              />
                              <View style={styles.liftPickerRow}>
                                {filterCanonicalLifts(tagSearch).map((lift) => (
                                  <TouchableOpacity
                                    key={lift}
                                    style={styles.liftPickerChip}
                                    onPress={() => {
                                      setLiftTags((prev) => ({ ...prev, [i]: lift }));
                                      setTagPickerIndex(null);
                                    }}
                                  >
                                    <Text style={styles.liftPickerChipText}>{lift}</Text>
                                  </TouchableOpacity>
                                ))}
                                {filterCanonicalLifts(tagSearch).length === 0 && (
                                  <Text style={styles.noExercisesHint}>No matching lifts</Text>
                                )}
                              </View>
                            </View>
                          )}

                          {comparisons.map((c, ci) => (
                            <Text key={ci} style={[styles.prescribedNote, c.wentAbove ? styles.prescribedAbove : styles.prescribedScaled]}>
                              {c.label}
                            </Text>
                          ))}
                        </View>
                      );
                    })}

                    {extractedWorkout.exercises.length === 0 && (
                      <Text style={styles.noExercisesHint}>No exercises added yet</Text>
                    )}

                    <TouchableOpacity style={styles.addExerciseBtn} onPress={addExercise}>
                      <Text style={styles.addExerciseBtnText}>+ Add Exercise</Text>
                    </TouchableOpacity>
                  </View>
                )}

                <View style={styles.nameInputBox}>
                  <Text style={styles.nameLabel}>Workout Name</Text>
                  <TextInput
                    style={styles.nameInput}
                    value={workoutName}
                    onChangeText={setWorkoutName}
                    placeholder="e.g., Pemby Pounder, CrossFit Comp, Mountain Run"
                    placeholderTextColor={RivalColors.textSecondary}
                  />
                </View>

                <View style={styles.nameInputBox}>
                  <Text style={styles.nameLabel}>Date (DD/MM/YYYY)</Text>
                  <TextInput
                    style={styles.nameInput}
                    value={activityDateStr}
                    onChangeText={setActivityDateStr}
                    placeholder="18/10/2026"
                    placeholderTextColor={RivalColors.textSecondary}
                    keyboardType="numbers-and-punctuation"
                  />
                </View>

                <View style={styles.nameInputBox}>
                  <Text style={styles.nameLabel}>Photos & Videos</Text>
                  <Text style={styles.mediaHint}>
                    Add a selfie, your view, or a clip — up to {MAX_PHOTOS} photos and {MAX_VIDEOS} video
                  </Text>
                  {mediaErrorMsg && (
                    <Text style={styles.mediaErrorText}>⚠️ {mediaErrorMsg}</Text>
                  )}
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.mediaRow}>
                    {extraMedia.map((item, i) => (
                      <View key={i} style={styles.mediaThumbWrap}>
                        {item.type === 'video' ? (
                          <View style={[styles.mediaThumb, styles.videoThumbPlaceholder]}>
                            <Text style={styles.videoThumbIcon}>🎬</Text>
                          </View>
                        ) : (
                          <Image source={{ uri: item.uri }} style={styles.mediaThumb} />
                        )}
                        <TouchableOpacity style={styles.mediaRemoveBtn} onPress={() => removeExtraMedia(i)}>
                          <Text style={styles.mediaRemoveText}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    ))}
                    {(() => {
                      const photoCount = extraMedia.filter(m => m.type === 'photo').length;
                      const videoCount = extraMedia.filter(m => m.type === 'video').length;
                      const atLimit = photoCount >= MAX_PHOTOS && videoCount >= MAX_VIDEOS;
                      return !atLimit ? (
                        <TouchableOpacity style={styles.mediaAddBtn} onPress={pickExtraMedia}>
                          <Text style={styles.mediaAddText}>+ Add</Text>
                        </TouchableOpacity>
                      ) : null;
                    })()}
                  </ScrollView>
                </View>

                <View style={styles.nameInputBox}>
                  <Text style={styles.nameLabel}>Notes</Text>
                  <TextInput
                    style={[styles.nameInput, styles.notesInput]}
                    value={userNotes}
                    onChangeText={setUserNotes}
                    placeholder="How did it feel? Tell us how it went..."
                    placeholderTextColor={RivalColors.textSecondary}
                    multiline
                    numberOfLines={3}
                  />
                </View>

                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={styles.changeBtn}
                    onPress={() => editActivityId
                      ? router.replace('/my-activities')
                      : (() => { setScanImages([]); setExtractedWorkout(null); setLiftTags({}); setTagPickerIndex(null); })()}
                    disabled={loading}
                  >
                    <Text style={styles.changeBtnText}>{editActivityId ? 'Cancel' : scanImages.length > 0 ? 'Change Photo' : 'Start Over'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.saveBtn}
                    onPress={saveWorkout}
                    disabled={loading}
                  >
                    <Text style={styles.saveBtnText}>
                      {loading ? '⏳ Saving...' : '✓ Save Workout'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}
          </View>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: RivalColors.surfaceLow },
  content: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 40 },
  header: { marginBottom: 24 },
  back: { color: RivalColors.accentText, fontSize: 16 },
  title: { fontSize: 32, fontWeight: '900', color: RivalColors.textPrimary, marginBottom: 32 },
  subtitle: { fontSize: 14, color: RivalColors.textSecondary, marginBottom: 16 },
  floatingErrorBar: { position: 'absolute', top: 8, left: 12, right: 12, zIndex: 50, backgroundColor: RivalColors.errorContainer, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: RivalColors.error, shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
  floatingErrorText: { color: RivalColors.error, fontSize: 13, fontWeight: '600' },
  successBanner: { backgroundColor: `${RivalColors.success}22`, borderRadius: 10, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: RivalColors.success },
  successBannerText: { color: RivalColors.success, fontSize: 13, fontWeight: '600' },
  enhanceCta: { marginTop: 12, gap: 8 },
  enhanceBtn: { backgroundColor: RivalColors.accentFill, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  enhanceBtnText: { color: RivalColors.onAccentFill, fontWeight: '800', fontSize: 15 },
  enhanceDoneText: { color: RivalColors.textSecondary, fontSize: 13, textAlign: 'center', paddingVertical: 6 },

  uploadArea: { alignItems: 'center', paddingVertical: 48, gap: 12 },
  uploadIcon: { fontSize: 64 },
  uploadTitle: { fontSize: 24, fontWeight: '800', color: RivalColors.textPrimary },
  uploadSub: { fontSize: 14, color: RivalColors.textSecondary, textAlign: 'center', maxWidth: 280 },
  howItWorksCard: { width: '100%', backgroundColor: RivalColors.surfaceLowest, borderRadius: 14, padding: 14, marginTop: 16, gap: 8, borderWidth: 1, borderColor: RivalColors.surfaceContainerHigh },
  howItWorksTitle: { fontSize: 13, fontWeight: '700', color: RivalColors.success, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 },
  howItWorksRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  howItWorksNum: { width: 20, height: 20, borderRadius: 10, backgroundColor: `${RivalColors.accentFill}22`, borderWidth: 1, borderColor: `${RivalColors.accentFill}55`, color: RivalColors.accentText, fontSize: 11, fontWeight: '800', textAlign: 'center', lineHeight: 18 },
  howItWorksText: { flex: 1, fontSize: 13, color: RivalColors.textSecondary, lineHeight: 18 },
  manualEntryBtn: { marginTop: 16, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: RivalColors.surfaceContainerHigh, alignItems: 'center' },
  weekScanLinkBtn: { marginTop: 10, paddingVertical: 10, alignItems: 'center' },
  weekScanLinkBtnText: { color: RivalColors.success, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  manualEntryBtnText: { color: RivalColors.textSecondary, fontSize: 14, fontWeight: '700' },
  buttonRow: { flexDirection: 'row', gap: 12, marginTop: 24 },
  uploadBtn: { flex: 1, backgroundColor: RivalColors.accentFill, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  uploadBtnText: { color: RivalColors.onAccentFill, fontSize: 15, fontWeight: '700' },

  previewSection: { gap: 16 },
  image: { width: '100%', maxHeight: 420, borderRadius: 14, backgroundColor: RivalColors.surfaceContainerHigh },
  scanImagesRow: { gap: 8 },
  scanImageThumb: { width: 160, height: 220, borderRadius: 12, backgroundColor: RivalColors.surfaceContainerHigh },
  scanImagesHint: { fontSize: 12, color: RivalColors.textSecondary, marginTop: 8, textAlign: 'center' },

  loadingBox: { alignItems: 'center', paddingVertical: 32, gap: 12 },
  loadingText: { color: RivalColors.textSecondary, fontSize: 15 },

  extractedBox: { backgroundColor: RivalColors.surfaceLowest, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: RivalColors.surfaceContainerHigh, gap: 12 },
  extractedLabel: { fontSize: 13, fontWeight: '700', color: RivalColors.textSecondary, textTransform: 'uppercase', letterSpacing: 1 },

  fieldRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: RivalColors.surfaceContainerHigh },
  fieldLabel: { fontSize: 13, color: RivalColors.textSecondary, fontWeight: '600' },
  fieldValue: { fontSize: 15, fontWeight: '700', color: RivalColors.textPrimary },
  fieldValueInput: { fontSize: 15, fontWeight: '700', color: RivalColors.textPrimary, backgroundColor: RivalColors.surfaceContainer, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: RivalColors.surfaceContainerHigh, minWidth: 80, textAlign: 'right' },
  classDurationHint: { fontSize: 12, color: RivalColors.success, backgroundColor: RivalColors.surfaceContainer, borderRadius: 8, padding: 10, marginTop: 6, marginBottom: 8, lineHeight: 17 },

  typeFieldBox: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: RivalColors.surfaceContainerHigh, gap: 8 },
  typeChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: RivalColors.surfaceContainerHigh, backgroundColor: RivalColors.surfaceLow, minWidth: 100, flexGrow: 1, flexBasis: '22%' },
  typeChipSelected: { borderColor: RivalColors.accentFill, backgroundColor: `${RivalColors.accentFill}22` },
  typeChipIcon: { fontSize: 14 },
  typeChipText: { fontSize: 13, fontWeight: '600', color: RivalColors.textSecondary },
  typeChipTextSelected: { color: RivalColors.accentText, fontWeight: '700' },

  exercisesBox: { marginTop: 8, gap: 6 },
  exercisesLabel: { fontSize: 12, fontWeight: '700', color: RivalColors.success, textTransform: 'uppercase', letterSpacing: 0.5 },
  exerciseItem: { fontSize: 13, color: RivalColors.textSecondary, marginLeft: 8 },
  prescribedNote: { fontSize: 11, fontWeight: '600', marginTop: 4 },
  prescribedAbove: { color: RivalColors.success },
  prescribedScaled: { color: RivalColors.tertiary },

  liftAutoTrackedText: { fontSize: 11, fontWeight: '700', color: RivalColors.success, marginTop: 6 },
  tagLiftBtn: { marginTop: 6, alignSelf: 'flex-start' },
  tagLiftBtnText: { fontSize: 11, fontWeight: '700', color: RivalColors.accentText },
  liftTagChip: { marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', backgroundColor: `${RivalColors.accentFill}22`, borderRadius: 8, paddingVertical: 4, paddingHorizontal: 8, borderWidth: 1, borderColor: RivalColors.accentFill },
  liftTagChipText: { fontSize: 11, fontWeight: '700', color: RivalColors.accentText },
  liftTagRemove: { fontSize: 12, fontWeight: '700', color: RivalColors.accentText },
  liftPickerBox: { marginTop: 8, backgroundColor: RivalColors.surfaceLowest, borderRadius: 10, borderWidth: 1, borderColor: RivalColors.surfaceContainerHigh, padding: 10 },
  liftSearchInput: { backgroundColor: RivalColors.surfaceContainer, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, color: RivalColors.textPrimary, fontSize: 14, borderWidth: 1, borderColor: RivalColors.surfaceContainerHigh },
  liftPickerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  liftPickerChip: { backgroundColor: RivalColors.surfaceLowest, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10, borderWidth: 1, borderColor: RivalColors.surfaceContainerHigh },
  liftPickerChipText: { fontSize: 11, fontWeight: '600', color: RivalColors.textSecondary },
  moreExercises: { fontSize: 12, color: RivalColors.textSecondary, fontStyle: 'italic', marginLeft: 8 },

  exerciseEditRow: { backgroundColor: RivalColors.surfaceLow, borderRadius: 10, padding: 12, marginTop: 8, borderWidth: 1, borderColor: RivalColors.surfaceContainerHigh, gap: 8 },
  exerciseName: { fontSize: 14, fontWeight: '700', color: RivalColors.textPrimary },
  exerciseNameInput: { fontSize: 14, fontWeight: '700', color: RivalColors.textPrimary, backgroundColor: RivalColors.surfaceContainer, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: RivalColors.surfaceContainerHigh },
  nameSuggestBox: { backgroundColor: RivalColors.surfaceLowest, borderRadius: 8, borderWidth: 1, borderColor: RivalColors.surfaceContainer, marginTop: 4, overflow: 'hidden' },
  nameSuggestItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: RivalColors.surfaceContainer },
  nameSuggestText: { color: RivalColors.textPrimary, fontSize: 14, fontWeight: '600' },
  nameSuggestHint: { color: RivalColors.success, fontSize: 11, fontWeight: '600' },
  exerciseNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  removeExerciseBtn: { padding: 6 },
  removeExerciseBtnText: { color: RivalColors.textSecondary, fontSize: 14, fontWeight: '700' },
  noExercisesHint: { fontSize: 13, color: RivalColors.textSecondary, textAlign: 'center', paddingVertical: 12 },
  addExerciseBtn: { marginTop: 8, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: `${RivalColors.accentFill}55`, alignItems: 'center' },
  addExerciseBtnText: { color: RivalColors.accentText, fontSize: 14, fontWeight: '700' },
  exerciseFieldsRow: { flexDirection: 'row', gap: 6 },
  exerciseFieldBox: { flex: 1, gap: 4, minWidth: 0 },
  exerciseFieldLabel: { fontSize: 9, color: RivalColors.textSecondary, fontWeight: '600', height: 12 },
  exerciseFieldInput: { backgroundColor: RivalColors.surfaceContainer, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 8, color: RivalColors.textPrimary, fontSize: 14, fontWeight: '600', borderWidth: 1, borderColor: RivalColors.surfaceContainerHigh, textAlign: 'center' },
  exercisesHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  unitTogglesRow: { flexDirection: 'row', gap: 8 },
  unitToggle: { flexDirection: 'row', backgroundColor: RivalColors.surfaceLow, borderRadius: 8, borderWidth: 1, borderColor: RivalColors.surfaceContainerHigh, overflow: 'hidden' },
  unitToggleBtn: { paddingHorizontal: 10, paddingVertical: 5 },
  unitToggleBtnActive: { backgroundColor: RivalColors.accentFill },
  unitToggleText: { fontSize: 11, fontWeight: '700', color: RivalColors.textSecondary },
  unitToggleTextActive: { color: RivalColors.onAccentFill },

  nameInputBox: { marginTop: 12, gap: 8 },
  nameLabel: { fontSize: 13, fontWeight: '700', color: RivalColors.textSecondary, textTransform: 'uppercase', letterSpacing: 1 },
  nameInput: { backgroundColor: RivalColors.surfaceContainer, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, color: RivalColors.textPrimary, fontSize: 16, borderWidth: 1, borderColor: RivalColors.surfaceContainerHigh },
  notesInput: { minHeight: 80, textAlignVertical: 'top' },
  mediaHint: { fontSize: 12, color: RivalColors.textSecondary, marginTop: -4 },
  mediaErrorText: { fontSize: 12, color: RivalColors.error, fontWeight: '600' },
  mediaRow: { flexDirection: 'row', gap: 10, paddingVertical: 4 },
  mediaThumbWrap: { position: 'relative' },
  mediaThumb: { width: 80, height: 80, borderRadius: 10, backgroundColor: RivalColors.surfaceContainerHigh },
  videoThumbPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  videoThumbIcon: { fontSize: 28 },
  mediaRemoveBtn: { position: 'absolute', top: -6, right: -6, backgroundColor: RivalColors.accentFill, borderRadius: 10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  mediaRemoveText: { color: RivalColors.onAccentFill, fontSize: 11, fontWeight: '800' },
  mediaAddBtn: { width: 80, height: 80, borderRadius: 10, borderWidth: 1, borderColor: RivalColors.accentFill, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  mediaAddText: { color: RivalColors.accentText, fontSize: 13, fontWeight: '700' },

  actionRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  changeBtn: { flex: 1, borderWidth: 1, borderColor: RivalColors.accentFill, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  changeBtnText: { color: RivalColors.accentText, fontSize: 15, fontWeight: '700' },
  saveBtn: { flex: 1, backgroundColor: RivalColors.accentFill, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  saveBtnText: { color: RivalColors.onAccentFill, fontSize: 15, fontWeight: '700' },
});
