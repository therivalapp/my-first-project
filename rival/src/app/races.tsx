import { useState, useCallback } from 'react';
import { StyleSheet, TouchableOpacity, View, Text, ScrollView, TextInput, Modal, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { supabase } from '../lib/supabase';
import { notify } from '../lib/notify';
import { formatDisplayName } from '../lib/identity';
import { isoToDisplayDate, displayToIsoDate } from '../lib/dateFormat';
import { formatGoalTimeMask } from '../lib/format';
import { RivalTopNav, RivalPageHeader, RivalIcon } from '../components/rival';
import type { RivalIconName } from '../components/rival';
import { RivalColors, RivalSerifFamily } from '../constants/rivalTheme';

const RACE_TYPES = ['Run', 'Ride', 'Swim', 'Triathlon', 'HYROX', 'CrossFit', 'Other', 'Custom'];

type RaceDirectory = { name: string; description: string; url: string; types: string[] };

const RACE_DIRECTORIES: RaceDirectory[] = [
  // Running
  { name: 'Squamish 50', description: 'Iconic trail ultra in the Sea to Sky corridor', url: 'https://www.squamish50.com', types: ['Run'] },
  { name: 'BC Athletics', description: 'Official road & trail races across British Columbia', url: 'https://www.bcathletics.org/events', types: ['Run'] },
  { name: 'parkrun Canada', description: 'Free weekly 5km events — Whistler & nearby', url: 'https://www.parkrun.ca', types: ['Run'] },
  { name: 'UltraSignUp', description: 'Trail & ultra running events in BC and beyond', url: 'https://ultrasignup.com/results_region.aspx?region=British+Columbia', types: ['Run'] },
  { name: 'iRunFar', description: 'Trail & ultra race calendar — Sea to Sky region', url: 'https://www.irunfar.com/races', types: ['Run'] },
  { name: 'Sportstats', description: 'Canadian race calendar & results platform', url: 'https://www.sportstats.ca', types: ['Run', 'Triathlon', 'Ride'] },
  // Triathlon
  { name: 'Triathlon BC', description: 'Official BC triathlon events including Ironman 70.3 Whistler', url: 'https://www.triathlonbc.ca/events', types: ['Triathlon', 'Swim'] },
  { name: 'IRONMAN', description: 'Full & 70.3 events — Whistler hosts an annual 70.3', url: 'https://www.ironman.com/races', types: ['Triathlon'] },
  // Cycling
  { name: 'Gran Fondo Whistler', description: 'Epic gran fondo through the Sea to Sky corridor', url: 'https://www.granfondowhistler.com', types: ['Ride'] },
  { name: 'Cycling BC', description: 'Road, mountain & gravel events across BC', url: 'https://www.cyclingbc.net/events', types: ['Ride'] },
  { name: 'Pemberton Gran Fondo', description: 'Road ride from Whistler to Pemberton', url: 'https://www.pembertongrfondo.com', types: ['Ride'] },
  // HYROX
  { name: 'HYROX', description: 'Official HYROX race finder — Vancouver events nearby', url: 'https://hyrox.com/races', types: ['HYROX'] },
  // CrossFit
  { name: 'CrossFit Games', description: 'CrossFit Open & sanctional events', url: 'https://games.crossfit.com', types: ['CrossFit'] },
  // Obstacles & Other
  { name: 'Spartan Race Canada', description: 'Obstacle course races across BC', url: 'https://www.spartan.com/en/race/find-race/detail.html?countryCode=CA', types: ['Other'] },
  { name: 'Tough Mudder Canada', description: 'Team obstacle events in BC', url: 'https://toughmudder.com/events', types: ['Other'] },
  { name: 'RaceRoster', description: 'Largest Canadian race registration platform', url: 'https://raceroster.com/events?province=BC', types: ['Run', 'Triathlon', 'Ride', 'Swim', 'Other'] },
];

// Real icons, not emoji — emoji render differently on every platform and sit
// outside the design system's colour and weight rules.
const RACE_TYPE_ICONS: Record<string, RivalIconName> = {
  Run: 'run', Ride: 'ride', Swim: 'swim', Triathlon: 'medal',
  HYROX: 'bolt', CrossFit: 'crossfit', Other: 'flag', Custom: 'flag',
};

const HYROX_STATIONS: { name: string; distance_km: number }[] = [
  { name: '8 × 1km Run', distance_km: 8 },
  { name: 'SkiErg', distance_km: 1 },
  { name: 'Sled Push', distance_km: 0.05 },
  { name: 'Sled Pull', distance_km: 0.05 },
  { name: 'Burpee Broad Jump', distance_km: 0.08 },
  { name: 'Row', distance_km: 1 },
  { name: 'Farmers Carry', distance_km: 0.2 },
  { name: 'Sandbag Lunges', distance_km: 0.1 },
  { name: 'Wall Balls', distance_km: 0 },
];

// Official HYROX format × division structure: Singles/Doubles/Relay, each with an
// Open and Pro division; Doubles and Relay also have Mixed alongside Men/Women.
const HYROX_CATEGORIES = [
  'Men', 'Women', 'Men Pro', 'Women Pro',
  'Doubles Men', 'Doubles Women', 'Doubles Mixed', 'Doubles Pro Men', 'Doubles Pro Women',
  'Relay Men', 'Relay Women', 'Relay Mixed',
];
const CROSSFIT_FORMATS = ['Open', 'Local Comp', 'Sanctional', 'Games'];

type Discipline = { name: string; distance_km: number };

type Race = {
  id: string;
  user_id: string;
  name: string;
  race_type: string;
  distance_km: number;
  race_date: string;
  location: string | null;
  registration_url: string | null;
  is_public: boolean;
  disciplines: Discipline[] | null;
  goal_finish_time: string | null;
  actual_finish_time: string | null;
  users: { display_name: string | null; email: string; username: string | null; display_style: string | null };
  interest_count: number;
  i_am_interested: boolean;
  avg_weekly_km: number;
};

function parseTimeToSeconds(t: string): number {
  const parts = t.trim().split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

function getFinishMessage(actualTime: string, goalTime: string | null): string {
  const actual = parseTimeToSeconds(actualTime);
  if (!goalTime || parseTimeToSeconds(goalTime) === 0) {
    const msgs = [
      "You finished. That's everything.",
      "Crossing that line took everything — and you did it.",
      "Every step was earned. Go celebrate.",
      "That finish line was yours. Own it.",
      "Doesn't matter what the clock says — you showed up and you finished.",
    ];
    return msgs[actual % msgs.length];
  }
  const goal = parseTimeToSeconds(goalTime);
  const diff = goal - actual;
  if (diff >= 600) return "You absolutely smashed your goal. That's what all those early mornings were for.";
  if (diff >= 60) return "Goal crushed. Every second of training showed up today.";
  if (diff >= -60) return "Right on target — that's not luck, that's discipline.";
  if (diff >= -300) return "Just shy of the goal, but you crossed that line. That takes everything.";
  if (diff >= -900) return "The time doesn't define the effort. You were out there when it counted.";
  return "Some races are harder than others. The fact you showed up, toed the line, and finished — that's the real achievement.";
}

function parseDateLocal(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function todayLocalStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function daysUntil(dateStr: string): number {
  const race = parseDateLocal(dateStr);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.ceil((race.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function formatRaceDate(dateStr: string): string {
  return parseDateLocal(dateStr).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function TrainingBar({ avgWeeklyKm, distanceKm }: { avgWeeklyKm: number; distanceKm: number }) {
  if (distanceKm <= 0) return null;
  const pct = Math.min(avgWeeklyKm / distanceKm, 1);
  const displayPct = Math.round(pct * 100);
  const done = pct >= 1;
  return (
    <View style={styles.trainingSection}>
      <View style={styles.trainingLabelRow}>
        <Text style={styles.trainingLabel}>Weekly avg vs race distance</Text>
        <Text style={[styles.trainingPct, done && { color: RivalColors.accentGold }]}>{displayPct}%</Text>
      </View>
      <View style={styles.trainingTrack}>
        <View style={[styles.trainingFill, { width: `${displayPct}%`, backgroundColor: done ? RivalColors.accentFill : RivalColors.accentFill }]} />
      </View>
      <Text style={styles.trainingMeta}>
        {avgWeeklyKm.toFixed(1)} km/week avg · {distanceKm} km race
      </Text>
    </View>
  );
}

export default function RacesScreen() {
  const { add } = useLocalSearchParams<{ add?: string }>();
  const [races, setRaces] = useState<Race[]>([]);
  const [completedRaces, setCompletedRaces] = useState<Race[]>([]);
  const [leagueMateIds, setLeagueMateIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState('');
  const [showAdd, setShowAdd] = useState(add === 'true');
  const [showFind, setShowFind] = useState(false);
  const [findFilter, setFindFilter] = useState<string | null>(null);
  const [editingRace, setEditingRace] = useState<Race | null>(null);
  const [activeTab, setActiveTab] = useState<'friends' | 'mine' | 'completed'>('mine');

  const [raceName, setRaceName] = useState('');
  const [raceType, setRaceType] = useState('Run');
  const [distanceKm, setDistanceKm] = useState('');
  const [raceDate, setRaceDate] = useState('');
  const [location, setLocation] = useState('');
  const [regUrl, setRegUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [triSwim, setTriSwim] = useState('');
  const [triBike, setTriBike] = useState('');
  const [triRun, setTriRun] = useState('');
  const [hyroxCategory, setHyroxCategory] = useState('Men');
  const [crossfitFormat, setCrossfitFormat] = useState('Open');
  const [goalFinishTime, setGoalFinishTime] = useState('');
  const [finishModalRace, setFinishModalRace] = useState<Race | null>(null);
  const [actualFinishInput, setActualFinishInput] = useState('');
  const [savingFinish, setSavingFinish] = useState(false);
  const [customDisciplines, setCustomDisciplines] = useState<{ name: string; distance: string }[]>([{ name: '', distance: '' }]);

  function computedDistance(): number {
    if (raceType === 'Triathlon') return (parseFloat(triSwim) || 0) + (parseFloat(triBike) || 0) + (parseFloat(triRun) || 0);
    if (raceType === 'HYROX') return 8;
    if (raceType === 'CrossFit') return 0;
    if (raceType === 'Custom') return customDisciplines.reduce((s, d) => s + (parseFloat(d.distance) || 0), 0);
    return parseFloat(distanceKm) || 0;
  }

  function buildDisciplines(): Discipline[] | null {
    if (raceType === 'Triathlon') return [
      { name: 'Swim', distance_km: parseFloat(triSwim) || 0 },
      { name: 'Bike', distance_km: parseFloat(triBike) || 0 },
      { name: 'Run', distance_km: parseFloat(triRun) || 0 },
    ];
    if (raceType === 'HYROX') return [{ name: hyroxCategory, distance_km: 0 }, ...HYROX_STATIONS];
    if (raceType === 'CrossFit') return [{ name: crossfitFormat, distance_km: 0 }];
    if (raceType === 'Custom') return customDisciplines.filter((d) => d.name.trim()).map((d) => ({ name: d.name.trim(), distance_km: parseFloat(d.distance) || 0 }));
    return null;
  }

  function addCustomDiscipline() { setCustomDisciplines((prev) => [...prev, { name: '', distance: '' }]); }
  function updateCustomDiscipline(index: number, field: 'name' | 'distance', value: string) {
    setCustomDisciplines((prev) => prev.map((d, i) => i === index ? { ...d, [field]: value } : d));
  }
  function removeCustomDiscipline(index: number) { setCustomDisciplines((prev) => prev.filter((_, i) => i !== index)); }

  function isFormValid(): boolean {
    if (!raceName || !raceDate || !displayToIsoDate(raceDate)) return false;
    if (raceType === 'Triathlon') return !!(triSwim || triBike || triRun);
    if (raceType === 'HYROX' || raceType === 'CrossFit') return true;
    if (raceType === 'Custom') return customDisciplines.some((d) => d.name.trim());
    return !!distanceKm;
  }

  useFocusEffect(useCallback(() => { load(); }, []));

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);

    const today = todayLocalStr();

    // Get league mates
    const { data: membershipData } = await supabase
      .from('league_members').select('league_id').eq('user_id', user.id).eq('status', 'active');
    const leagueIds = (membershipData || []).map((m: any) => m.league_id);

    let friendIds: string[] = [];
    if (leagueIds.length > 0) {
      const { data: leagueMembersData } = await supabase
        .from('league_members').select('user_id').in('league_id', leagueIds).neq('user_id', user.id).eq('status', 'active');
      friendIds = [...new Set((leagueMembersData || []).map((m: any) => m.user_id))];
    }
    const friendSet = new Set(friendIds);
    setLeagueMateIds(friendSet);

    const [racesRes, pastRes, interestsRes, activitiesRes] = await Promise.all([
      supabase.from('races').select('*, users(display_name, email, username, display_style)')
        .or(`is_public.eq.true,user_id.eq.${user.id}`)
        .gte('race_date', today).order('race_date', { ascending: true }),
      supabase.from('races').select('*, users(display_name, email, username, display_style)')
        .eq('user_id', user.id).lt('race_date', today).order('race_date', { ascending: false }),
      supabase.from('race_interests').select('race_id, user_id'),
      supabase.from('activities').select('distance_meters, started_at')
        .eq('user_id', user.id)
        .gte('started_at', new Date(Date.now() - 56 * 24 * 60 * 60 * 1000).toISOString()),
    ]);

    const totalKm = (activitiesRes.data || []).reduce((s, a) => s + (a.distance_meters || 0), 0) / 1000;
    const avgWeeklyKm = totalKm / 8;

    const withMeta = (racesRes.data || []).map((r: any) => {
      const raceInterests = (interestsRes.data || []).filter((i: any) => i.race_id === r.id);
      return { ...r, interest_count: raceInterests.length, i_am_interested: raceInterests.some((i: any) => i.user_id === user.id), avg_weekly_km: avgWeeklyKm };
    });

    setRaces(withMeta);
    setCompletedRaces((pastRes.data || []).map((r: any) => ({ ...r, interest_count: 0, i_am_interested: false, avg_weekly_km: avgWeeklyKm })));
    setLoading(false);
  }

  async function toggleInterest(race: Race) {
    if (race.user_id === userId) return;
    if (race.i_am_interested) {
      const { error } = await supabase.from('race_interests').delete().eq('race_id', race.id).eq('user_id', userId);
      if (error) notify("Couldn't update your interest", error.message);
    } else {
      const { error } = await supabase.from('race_interests').insert({ race_id: race.id, user_id: userId });
      if (error) notify("Couldn't update your interest", error.message);
    }
    load();
  }

  async function saveRace() {
    if (!isFormValid()) return;
    const isoDate = displayToIsoDate(raceDate);
    if (!isoDate) return;
    setSaving(true);
    const payload = {
      name: raceName.trim(), race_type: raceType, distance_km: computedDistance(),
      race_date: isoDate, location: location.trim() || null,
      registration_url: regUrl.trim() || null, disciplines: buildDisciplines(),
      goal_finish_time: goalFinishTime.trim() || null,
    };
    if (editingRace) {
      const { error: updErr } = await supabase.from('races').update(payload).eq('id', editingRace.id);
      if (updErr) {
        // Clear the spinner and leave the modal open with their input intact,
        // rather than returning past setSaving(false) below.
        setSaving(false);
        notify("Couldn't save that race", updErr.message);
        return;
      }
    } else {
      const { data: newRace, error: newErr } = await supabase
        .from('races')
        .insert({ ...payload, user_id: userId, is_public: true })
        .select('id')
        .single();
      if (newErr) {
        setSaving(false);
        notify("Couldn't add that race", newErr.message);
        return;
      }
      if (newRace) notifyLeagueMatesOfNewRace(newRace.id);
    }
    setSaving(false);
    closeModal();
    load();
  }

  async function notifyLeagueMatesOfNewRace(raceId: string) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/race-added-notifications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
        },
        body: JSON.stringify({ raceId }),
      });
    } catch {
      // best-effort — don't block the race save on notification failures
    }
  }

  function openEdit(race: Race) {
    setEditingRace(race);
    setRaceName(race.name); setRaceType(race.race_type); setRaceDate(isoToDisplayDate(race.race_date));
    setLocation(race.location || ''); setRegUrl(race.registration_url || '');
    setGoalFinishTime(race.goal_finish_time || '');
    if (race.race_type === 'Triathlon' && race.disciplines) {
      setTriSwim(String(race.disciplines.find((d) => d.name === 'Swim')?.distance_km ?? ''));
      setTriBike(String(race.disciplines.find((d) => d.name === 'Bike')?.distance_km ?? ''));
      setTriRun(String(race.disciplines.find((d) => d.name === 'Run')?.distance_km ?? ''));
    } else if (race.race_type === 'CrossFit' && race.disciplines?.[0]) {
      setCrossfitFormat(race.disciplines[0].name);
    } else if (race.race_type === 'HYROX' && race.disciplines?.[0]) {
      setHyroxCategory(race.disciplines[0].name);
    } else if (race.race_type === 'Custom' && race.disciplines) {
      setCustomDisciplines(race.disciplines.map((d) => ({ name: d.name, distance: String(d.distance_km) })));
    } else {
      setDistanceKm(String(race.distance_km));
    }
    setShowAdd(true);
  }

  function closeModal() {
    setShowAdd(false); setEditingRace(null);
    setRaceName(''); setDistanceKm(''); setRaceDate('');
    setLocation(''); setRegUrl(''); setRaceType('Run');
    setTriSwim(''); setTriBike(''); setTriRun('');
    setHyroxCategory('Singles'); setCrossfitFormat('Open');
    setGoalFinishTime('');
    setCustomDisciplines([{ name: '', distance: '' }]);
  }

  async function deleteRace(id: string) {
    if (typeof window !== 'undefined' && !window.confirm('Delete this race?')) return;
    const { error } = await supabase.from('races').delete().eq('id', id);
    if (error) {
      notify("Couldn't delete that race", error.message);
      return;
    }
    setRaces((prev) => prev.filter((r) => r.id !== id));
  }

  async function saveActualFinishTime() {
    if (!finishModalRace || !actualFinishInput.trim()) return;
    setSavingFinish(true);
    const { error } = await supabase.from('races').update({ actual_finish_time: actualFinishInput.trim() }).eq('id', finishModalRace.id);
    if (error) {
      setSavingFinish(false);
      notify("Couldn't save your finish time", error.message);
      return;
    }
    setSavingFinish(false);
    setFinishModalRace(null);
    setActualFinishInput('');
    load();
  }

  const myRaces = races.filter((r) => r.user_id === userId);
  const friendRaces = races.filter((r) => leagueMateIds.has(r.user_id));
  const displayed = activeTab === 'mine' ? myRaces : activeTab === 'completed' ? completedRaces : friendRaces;

  return (
    <SafeAreaView style={styles.container}>
      <RivalTopNav active="today" />
      <ScrollView contentContainerStyle={styles.content}>

        <View style={styles.header}>
          <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/home'))}>
            <Text style={styles.back}>← Back</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.titleRow}>
          <RivalPageHeader title="Races" subtitle="What are you training for?" rules={false} />
          <View style={styles.titleButtons}>
            <TouchableOpacity style={styles.findBtn} onPress={() => { setFindFilter(null); setShowFind(true); }}>
              <Text style={styles.findBtnText}>Find</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.addBtn} onPress={() => setShowAdd(true)}>
              <Text style={styles.addBtnText}>+ Add</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.tabs}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'mine' && styles.tabActive]}
            onPress={() => setActiveTab('mine')}
          >
            <Text style={[styles.tabText, activeTab === 'mine' && styles.tabTextActive]}>
              Mine ({myRaces.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'friends' && styles.tabActive]}
            onPress={() => setActiveTab('friends')}
          >
            <Text style={[styles.tabText, activeTab === 'friends' && styles.tabTextActive]}>
              Friends ({friendRaces.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'completed' && styles.tabActive]}
            onPress={() => setActiveTab('completed')}
          >
            <Text style={[styles.tabText, activeTab === 'completed' && styles.tabTextActive]}>
              Completed ({completedRaces.length})
            </Text>
          </TouchableOpacity>
        </View>

        {loading && <Text style={styles.emptyText}>Loading…</Text>}

        {!loading && displayed.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🏁</Text>
            <Text style={styles.emptyText}>
              {activeTab === 'mine'
                ? "You haven't added any races yet."
                : activeTab === 'completed'
                ? "No completed races yet. Get out there!"
                : leagueMateIds.size === 0
                ? "Join a team to see your friends' races here."
                : "None of your teammates have added a race yet."}
            </Text>
          </View>
        )}

        {displayed.map((race) => {
          const isOwn = race.user_id === userId;
          const days = daysUntil(race.race_date);
          const past = days < 0;
          const ownerName = race.users ? formatDisplayName(race.users) : undefined;

          return (
            <View key={race.id} style={[styles.raceCard, isOwn && styles.raceCardOwn, past && styles.raceCardCompleted]}>

              <View style={styles.raceHeader}>
                <View style={styles.raceTypeRow}>
                  <RivalIcon name={RACE_TYPE_ICONS[race.race_type] ?? 'flag'} size={26} color={RivalColors.accentText} />
                  <View style={styles.raceMeta}>
                    <Text style={styles.raceTypeLabel}>{race.race_type.toUpperCase()}</Text>
                    {!isOwn && <Text style={styles.raceOwner}>{ownerName}</Text>}
                    {isOwn && <Text style={styles.raceOwnerYou}>Your race</Text>}
                  </View>
                </View>
                {isOwn && (
                  <View style={styles.ownActions}>
                    <TouchableOpacity onPress={() => openEdit(race)}>
                      <Text style={styles.editBtn}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => deleteRace(race.id)}>
                      <Text style={styles.deleteBtn}>✕</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              <Text style={styles.raceName}>{race.name}</Text>

              <View style={styles.raceDetails}>
                {race.location ? (
                  <View style={styles.raceDetailRow}>
                    <RivalIcon name="location" size={13} color={RivalColors.textSecondary} />
                    <Text style={styles.raceDetail}>{race.location}</Text>
                  </View>
                ) : null}
                {race.distance_km > 0 && (
                  <View style={styles.raceDetailRow}>
                    <RivalIcon name="distance" size={13} color={RivalColors.textSecondary} />
                    <Text style={styles.raceDetail}>{race.distance_km} km</Text>
                  </View>
                )}
                <View style={styles.raceDetailRow}>
                  <RivalIcon name="calendar" size={13} color={RivalColors.textSecondary} />
                  <Text style={styles.raceDetail}>{formatRaceDate(race.race_date)}</Text>
                </View>
              </View>

              {race.disciplines && race.disciplines.length > 0 && (
                <View style={styles.disciplinesRow}>
                  {race.disciplines.map((d, i) => (
                    <View key={i} style={styles.disciplineChip}>
                      <Text style={styles.disciplineChipText}>{d.name}{d.distance_km > 0 ? ` · ${d.distance_km}km` : ''}</Text>
                    </View>
                  ))}
                </View>
              )}

              {!past && (
                <View style={styles.countdownRow}>
                  <Text style={styles.countdownNum}>{days}</Text>
                  <Text style={styles.countdownLabel}>days to go</Text>
                </View>
              )}

              {!past && race.goal_finish_time && (
                <View style={styles.goalTimeRow}>
                  <Text style={styles.goalTimeLabel}>🎯 Goal</Text>
                  <Text style={styles.goalTimeValue}>{race.goal_finish_time}</Text>
                </View>
              )}

              {past && (
                <View style={styles.completedBadge}>
                  <Text style={styles.completedBadgeText}>✓ Race completed</Text>
                </View>
              )}

              {past && isOwn && race.actual_finish_time && (
                <View style={styles.finishTimesBlock}>
                  <View style={styles.finishTimeRow}>
                    <Text style={styles.finishTimeLabel}>Finish time</Text>
                    <Text style={styles.finishTimeValue}>{race.actual_finish_time}</Text>
                  </View>
                  {race.goal_finish_time && (
                    <View style={styles.finishTimeRow}>
                      <Text style={styles.finishTimeLabel}>Goal</Text>
                      <Text style={[
                        styles.finishTimeValue,
                        parseTimeToSeconds(race.actual_finish_time) <= parseTimeToSeconds(race.goal_finish_time)
                          ? styles.finishBeat : styles.finishMissed,
                      ]}>
                        {race.goal_finish_time}
                        {parseTimeToSeconds(race.actual_finish_time) <= parseTimeToSeconds(race.goal_finish_time) ? ' ✓' : ''}
                      </Text>
                    </View>
                  )}
                  <Text style={styles.finishMessage}>
                    {getFinishMessage(race.actual_finish_time, race.goal_finish_time)}
                  </Text>
                </View>
              )}

              {past && isOwn && !race.actual_finish_time && (
                <TouchableOpacity style={styles.logFinishBtn} onPress={() => { setFinishModalRace(race); setActualFinishInput(''); }}>
                  <Text style={styles.logFinishBtnText}>+ Log your finish time</Text>
                </TouchableOpacity>
              )}

              {isOwn && !past && <TrainingBar avgWeeklyKm={race.avg_weekly_km} distanceKm={race.distance_km} />}

              <View style={styles.raceFooter}>
                {!isOwn && (
                  <TouchableOpacity
                    style={[styles.interestedBtn, race.i_am_interested && styles.interestedBtnActive]}
                    onPress={() => toggleInterest(race)}
                  >
                    <Text style={[styles.interestedBtnText, race.i_am_interested && styles.interestedBtnTextActive]}>
                      {race.i_am_interested ? "I'm in ✓" : "I'm in too"}
                    </Text>
                  </TouchableOpacity>
                )}
                {race.interest_count > 0 && (
                  <Text style={styles.interestCount}>
                    {race.interest_count} {race.interest_count === 1 ? 'person' : 'people'} in
                  </Text>
                )}
                {race.registration_url && (
                  <TouchableOpacity onPress={() => Linking.openURL(race.registration_url!)}>
                    <Text style={styles.registerLink}>
                      {isOwn ? 'Register →' : `Join ${ownerName} — register →`}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

            </View>
          );
        })}

      </ScrollView>

      {/* Add / Edit Race Modal */}
      <Modal visible={showAdd} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalCard}>
            <Text style={styles.modalTitle}>{editingRace ? 'Edit Race' : 'Add a Race'}</Text>

            <Text style={styles.modalLabel}>Race name</Text>
            <TextInput style={styles.modalInput} placeholder="e.g. Auckland Half Marathon" placeholderTextColor={RivalColors.textSecondary} value={raceName} onChangeText={setRaceName} />

            <Text style={styles.modalLabel}>Type</Text>
            <View style={styles.segmentRow}>
              {RACE_TYPES.map((t) => (
                <TouchableOpacity key={t} style={[styles.segment, raceType === t && styles.segmentActive]} onPress={() => setRaceType(t)}>
                  <Text style={[styles.segmentText, raceType === t && styles.segmentTextActive]}>{RACE_TYPE_ICONS[t]} {t}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {raceType !== 'Triathlon' && raceType !== 'HYROX' && raceType !== 'CrossFit' && raceType !== 'Custom' && (
              <>
                <Text style={styles.modalLabel}>Distance (km)</Text>
                <TextInput style={styles.modalInput} placeholder="21.1" placeholderTextColor={RivalColors.textSecondary} value={distanceKm} onChangeText={setDistanceKm} keyboardType="decimal-pad" />
              </>
            )}

            {raceType === 'Triathlon' && (
              <>
                <Text style={styles.modalLabel}>Disciplines</Text>
                {[['Swim (km)', triSwim, setTriSwim, '1.9'], ['Bike (km)', triBike, setTriBike, '90'], ['Run (km)', triRun, setTriRun, '21.1']].map(([label, val, setter, ph]: any) => (
                  <View key={label} style={styles.disciplineInputRow}>
                    <Text style={styles.disciplineInputLabel}>{label}</Text>
                    <TextInput style={[styles.modalInput, styles.disciplineInput]} placeholder={ph} placeholderTextColor={RivalColors.textSecondary} value={val} onChangeText={setter} keyboardType="decimal-pad" />
                  </View>
                ))}
                {computedDistance() > 0 && <Text style={styles.distanceSummary}>Total: {computedDistance().toFixed(1)} km</Text>}
              </>
            )}

            {raceType === 'Custom' && (
              <>
                <Text style={styles.modalLabel}>Disciplines</Text>
                {customDisciplines.map((d, i) => (
                  <View key={i} style={styles.customDisciplineRow}>
                    <TextInput style={[styles.modalInput, { flex: 1 }]} placeholder="e.g. Kayak" placeholderTextColor={RivalColors.textSecondary} value={d.name} onChangeText={(v) => updateCustomDiscipline(i, 'name', v)} />
                    <TextInput style={[styles.modalInput, styles.disciplineInput]} placeholder="km" placeholderTextColor={RivalColors.textSecondary} value={d.distance} onChangeText={(v) => updateCustomDiscipline(i, 'distance', v)} keyboardType="decimal-pad" />
                    {customDisciplines.length > 1 && (
                      <TouchableOpacity onPress={() => removeCustomDiscipline(i)}><Text style={styles.removeDisc}>✕</Text></TouchableOpacity>
                    )}
                  </View>
                ))}
                <TouchableOpacity style={styles.addDisciplineBtn} onPress={addCustomDiscipline}>
                  <Text style={styles.addDisciplineBtnText}>+ Add discipline</Text>
                </TouchableOpacity>
                {computedDistance() > 0 && <Text style={styles.distanceSummary}>Total: {computedDistance().toFixed(1)} km</Text>}
              </>
            )}

            {raceType === 'HYROX' && (
              <>
                <Text style={styles.modalLabel}>Category</Text>
                <View style={styles.segmentRow}>
                  {HYROX_CATEGORIES.map((c) => (
                    <TouchableOpacity key={c} style={[styles.segment, hyroxCategory === c && styles.segmentActive]} onPress={() => setHyroxCategory(c)}>
                      <Text style={[styles.segmentText, hyroxCategory === c && styles.segmentTextActive]}>{c}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={styles.infoBox}>
                  <Text style={styles.infoBoxTitle}>⚡ Standard HYROX Format</Text>
                  <Text style={styles.infoBoxText}>8 × 1km Run · SkiErg 1km · Sled Push · Sled Pull · Burpee Broad Jump · Row 1km · Farmers Carry · Sandbag Lunges · Wall Balls</Text>
                  <Text style={styles.infoBoxAccent}>8km run total</Text>
                </View>
              </>
            )}

            {raceType === 'CrossFit' && (
              <>
                <Text style={styles.modalLabel}>Format</Text>
                <View style={styles.segmentRow}>
                  {CROSSFIT_FORMATS.map((f) => (
                    <TouchableOpacity key={f} style={[styles.segment, crossfitFormat === f && styles.segmentActive]} onPress={() => setCrossfitFormat(f)}>
                      <Text style={[styles.segmentText, crossfitFormat === f && styles.segmentTextActive]}>{f}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={styles.infoBox}>
                  <Text style={styles.infoBoxTitle}>🏋️ CrossFit Competition</Text>
                  <Text style={styles.infoBoxText}>Multiple WODs over the event period. Add a registration link so your team can follow along.</Text>
                </View>
              </>
            )}

            <Text style={styles.modalLabel}>Race date (DD/MM/YYYY)</Text>
            <TextInput style={styles.modalInput} placeholder="18/10/2026" placeholderTextColor={RivalColors.textSecondary} value={raceDate} onChangeText={setRaceDate} keyboardType="numbers-and-punctuation" />

            <Text style={styles.modalLabel}>Location (optional)</Text>
            <TextInput style={styles.modalInput} placeholder="Auckland, NZ" placeholderTextColor={RivalColors.textSecondary} value={location} onChangeText={setLocation} />

            <Text style={styles.modalLabel}>Registration link (optional)</Text>
            <TextInput style={styles.modalInput} placeholder="https://…" placeholderTextColor={RivalColors.textSecondary} value={regUrl} onChangeText={setRegUrl} autoCapitalize="none" />

            <Text style={styles.modalLabel}>Goal finish time (optional)</Text>
            <TextInput style={styles.modalInput} placeholder="00:00:00" placeholderTextColor={RivalColors.textSecondary} value={goalFinishTime} onChangeText={v => setGoalFinishTime(formatGoalTimeMask(v))} keyboardType="number-pad" autoCapitalize="none" />
            <Text style={styles.goalTimeHint}>
              {goalFinishTime.trim()
                ? `🎯 Aiming for ${goalFinishTime.trim()} — let's make it happen.`
                : 'Set a time to aim for — you can always chase it down on race day.'}
            </Text>

            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.cancelButton} onPress={closeModal}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveButton, (!isFormValid() || saving) && styles.saveButtonDisabled]}
                onPress={saveRace} disabled={!isFormValid() || saving}
              >
                <Text style={styles.saveButtonText}>{saving ? 'Saving…' : editingRace ? 'Save Changes' : 'Add Race'}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Find a Race Modal */}
      <Modal visible={showFind} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.findModalCard}>
            <View style={styles.findModalHeader}>
              <Text style={styles.modalTitle}>Find a Race</Text>
              <TouchableOpacity onPress={() => setShowFind(false)}>
                <Text style={styles.findModalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.findModalSub}>Sea to Sky · BC · Canada</Text>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.findFilterScroll} contentContainerStyle={styles.findFilterRow}>
              <TouchableOpacity
                style={[styles.findFilterChip, findFilter === null && styles.findFilterChipActive]}
                onPress={() => setFindFilter(null)}
              >
                <Text style={[styles.findFilterText, findFilter === null && styles.findFilterTextActive]}>All</Text>
              </TouchableOpacity>
              {['Run', 'Ride', 'Swim', 'Triathlon', 'HYROX', 'CrossFit', 'Other'].map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[styles.findFilterChip, findFilter === t && styles.findFilterChipActive]}
                  onPress={() => setFindFilter(findFilter === t ? null : t)}
                >
                  <Text style={[styles.findFilterText, findFilter === t && styles.findFilterTextActive]}>
                    {RACE_TYPE_ICONS[t]} {t}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <ScrollView style={styles.findDirectoryList} showsVerticalScrollIndicator={false}>
              {RACE_DIRECTORIES
                .filter((d) => !findFilter || d.types.includes(findFilter))
                .map((dir) => (
                  <TouchableOpacity
                    key={dir.name}
                    style={styles.directoryCard}
                    onPress={() => Linking.openURL(dir.url)}
                  >
                    <View style={styles.directoryInfo}>
                      <Text style={styles.directoryName}>{dir.name}</Text>
                      <Text style={styles.directoryDesc}>{dir.description}</Text>
                      <View style={styles.directoryTypes}>
                        {dir.types.map((t) => (
                          <View key={t} style={styles.directoryTypeChip}>
                            <Text style={styles.directoryTypeText}>{RACE_TYPE_ICONS[t]} {t}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                    <Text style={styles.directoryArrow}>→</Text>
                  </TouchableOpacity>
                ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Log Finish Time Modal */}
      <Modal visible={!!finishModalRace} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.finishModalCard}>
            <Text style={styles.modalTitle}>Log Finish Time</Text>
            <Text style={styles.finishModalRaceName}>{finishModalRace?.name}</Text>

            {finishModalRace?.goal_finish_time && (
              <View style={styles.goalTimeRow}>
                <Text style={styles.finishTimeLabel}>Your goal was</Text>
                <Text style={styles.finishTimeValue}>{finishModalRace.goal_finish_time}</Text>
              </View>
            )}

            <Text style={[styles.modalLabel, { marginTop: 16 }]}>Your finish time</Text>
            <TextInput
              style={styles.modalInput} placeholder="e.g. 1:52:34" placeholderTextColor={RivalColors.textSecondary}
              value={actualFinishInput} onChangeText={setActualFinishInput}
              autoCapitalize="none" autoFocus
            />

            {actualFinishInput.trim() ? (
              <View style={styles.finishPreviewBox}>
                <Text style={styles.finishPreviewMessage}>
                  {getFinishMessage(actualFinishInput.trim(), finishModalRace?.goal_finish_time ?? null)}
                </Text>
              </View>
            ) : (
              <Text style={styles.finishModalHint}>However it went — you were out there. That already counts.</Text>
            )}

            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.cancelButton} onPress={() => { setFinishModalRace(null); setActualFinishInput(''); }}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveButton, (!actualFinishInput.trim() || savingFinish) && styles.saveButtonDisabled]}
                onPress={saveActualFinishTime} disabled={!actualFinishInput.trim() || savingFinish}
              >
                <Text style={styles.saveButtonText}>{savingFinish ? 'Saving…' : 'Save'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: RivalColors.surfaceLow },
  content: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 48 },
  header: { marginBottom: 24 },
  back: { color: RivalColors.accentFill, fontSize: 16 },

  titleRow: { flexDirection: 'column', alignItems: 'center', gap: 12, marginBottom: 24 },
  title: { fontSize: 32, fontWeight: '900', color: RivalColors.textPrimary, marginBottom: 4 },
  subtitle: { fontSize: 14, color: RivalColors.textSecondary },
  titleButtons: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  findBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: RivalColors.accentText },
  findBtnText: { color: RivalColors.accentText, fontWeight: '700', fontSize: 15 },
  addBtn: { backgroundColor: RivalColors.accentFill, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10 },
  addBtnText: { color: RivalColors.textPrimary, fontWeight: '700', fontSize: 15 },

  findModalCard: { backgroundColor: RivalColors.surfaceContainer, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 28, paddingBottom: 0, maxHeight: '85%', marginTop: 'auto' },
  findModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  findModalClose: { color: RivalColors.textSecondary, fontSize: 20, padding: 4 },
  findModalSub: { fontSize: 13, color: RivalColors.textSecondary, marginBottom: 16 },
  findFilterScroll: { flexGrow: 0, marginBottom: 16 },
  findFilterRow: { flexDirection: 'row', gap: 8, paddingBottom: 4 },
  findFilterChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: RivalColors.surfaceHigh, backgroundColor: RivalColors.surfaceContainer },
  findFilterChipActive: { backgroundColor: RivalColors.accentText, borderColor: RivalColors.accentText },
  findFilterText: { fontSize: 13, fontWeight: '600', color: RivalColors.textSecondary },
  findFilterTextActive: { color: RivalColors.surfaceLow },
  findDirectoryList: { marginHorizontal: -28, paddingHorizontal: 28 },
  directoryCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: RivalColors.surfaceContainer, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: RivalColors.surfaceHigh, gap: 12 },
  directoryInfo: { flex: 1, gap: 4 },
  directoryName: { fontSize: 15, fontWeight: '700', color: RivalColors.textPrimary },
  directoryDesc: { fontSize: 12, color: RivalColors.textSecondary },
  directoryTypes: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 2 },
  directoryTypeChip: { backgroundColor: RivalColors.surfaceContainer, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: RivalColors.surfaceHigh },
  directoryTypeText: { fontSize: 10, color: RivalColors.textSecondary, fontWeight: '600' },
  directoryArrow: { fontSize: 18, color: RivalColors.accentText },

  tabs: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  tab: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: RivalColors.surfaceHigh, backgroundColor: RivalColors.surfaceContainer },
  tabActive: { backgroundColor: RivalColors.accentFill, borderColor: RivalColors.accentFill },
  tabText: { color: RivalColors.textSecondary, fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: RivalColors.textPrimary },

  emptyState: { paddingVertical: 40, alignItems: 'center', gap: 10 },
  emptyIcon: { fontSize: 36 },
  emptyText: { color: RivalColors.textSecondary, textAlign: 'center', fontSize: 14, lineHeight: 20 },

  raceCard: {
    backgroundColor: RivalColors.surfaceContainer,
    borderRadius: 16, padding: 20, marginBottom: 16,
    borderWidth: 1, borderColor: RivalColors.surfaceHigh, gap: 12,
  },
  raceCardOwn: { borderColor: RivalColors.accentText },
  raceCardCompleted: { opacity: 0.7 },

  raceHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  raceTypeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  raceTypeIcon: { fontSize: 28 },
  raceMeta: { gap: 2 },
  raceTypeLabel: { fontSize: 11, fontWeight: '800', color: RivalColors.accentFill, letterSpacing: 1 },
  raceOwner: { fontSize: 12, color: RivalColors.textSecondary },
  raceOwnerYou: { fontSize: 12, color: RivalColors.accentText, fontWeight: '600' },
  ownActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  editBtn: { color: RivalColors.accentFill, fontSize: 14, fontWeight: '700' },
  deleteBtn: { color: RivalColors.textSecondary, fontSize: 18, padding: 4 },

  raceName: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 22, fontWeight: '700', color: RivalColors.textPrimary },
  raceDetails: { gap: 4 },
  raceDetailRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  raceDetail: { fontSize: 13, color: RivalColors.textSecondary },

  disciplinesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  disciplineChip: { backgroundColor: RivalColors.surfaceContainer, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: RivalColors.surfaceHigh },
  disciplineChipText: { color: RivalColors.textSecondary, fontSize: 12, fontWeight: '600' },

  countdownRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  countdownNum: { fontSize: 36, fontWeight: '900', color: RivalColors.textPrimary },
  countdownLabel: { fontSize: 14, color: RivalColors.textSecondary, fontWeight: '600' },

  goalTimeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: RivalColors.surfaceContainer, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: RivalColors.surfaceHigh },
  goalTimeLabel: { fontSize: 12, color: RivalColors.textSecondary, fontWeight: '600' },
  goalTimeValue: { fontSize: 15, color: RivalColors.accentFill, fontWeight: '800' },

  completedBadge: { backgroundColor: 'rgba(245,183,89,0.12)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start', borderWidth: 1, borderColor: 'rgba(245,183,89,0.35)' },
  completedBadgeText: { color: RivalColors.accentGold, fontSize: 13, fontWeight: '700' },

  finishTimesBlock: { backgroundColor: RivalColors.surfaceContainer, borderRadius: 12, padding: 14, gap: 8, borderWidth: 1, borderColor: RivalColors.surfaceHigh },
  finishTimeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  finishTimeLabel: { fontSize: 12, color: RivalColors.textSecondary, fontWeight: '600' },
  finishTimeValue: { fontSize: 16, color: RivalColors.textPrimary, fontWeight: '800' },
  finishBeat: { color: RivalColors.accentGold },
  finishMissed: { color: RivalColors.accentGold },
  finishMessage: { fontSize: 13, color: RivalColors.textSecondary, fontStyle: 'italic', lineHeight: 19, marginTop: 4 },

  logFinishBtn: { borderWidth: 1, borderColor: RivalColors.accentFill, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  logFinishBtnText: { color: RivalColors.accentFill, fontSize: 14, fontWeight: '700' },

  trainingSection: { gap: 6 },
  trainingLabelRow: { flexDirection: 'row', justifyContent: 'space-between' },
  trainingLabel: { fontSize: 12, color: RivalColors.textSecondary, fontWeight: '600' },
  trainingPct: { fontSize: 12, color: RivalColors.accentFill, fontWeight: '700' },
  trainingTrack: { height: 8, backgroundColor: RivalColors.surfaceHigh, borderRadius: 4 },
  trainingFill: { height: '100%', borderRadius: 4 },
  trainingMeta: { fontSize: 11, color: RivalColors.textSecondary },

  raceFooter: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  interestedBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: RivalColors.accentFill },
  interestedBtnActive: { backgroundColor: RivalColors.accentFill },
  interestedBtnText: { color: RivalColors.accentFill, fontWeight: '700', fontSize: 13 },
  interestedBtnTextActive: { color: RivalColors.textPrimary },
  interestCount: { fontSize: 12, color: RivalColors.textSecondary, flex: 1 },
  registerLink: { color: RivalColors.accentText, fontSize: 13, fontWeight: '700' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  modalScroll: { maxHeight: '90%' },
  modalCard: { backgroundColor: RivalColors.surfaceContainer, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 28, gap: 12 },
  modalTitle: { fontSize: 22, fontWeight: '900', color: RivalColors.textPrimary, marginBottom: 4 },
  modalLabel: { fontSize: 12, fontWeight: '700', color: RivalColors.textSecondary, textTransform: 'uppercase', letterSpacing: 1 },
  modalInput: { backgroundColor: RivalColors.surfaceContainer, borderRadius: 10, padding: 14, color: RivalColors.textPrimary, fontSize: 16, borderWidth: 1, borderColor: RivalColors.surfaceHigh },

  segmentRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  segment: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: RivalColors.surfaceHigh, backgroundColor: RivalColors.surfaceContainer },
  segmentActive: { backgroundColor: RivalColors.accentFill, borderColor: RivalColors.accentFill },
  segmentText: { color: RivalColors.textSecondary, fontSize: 13, fontWeight: '600' },
  segmentTextActive: { color: RivalColors.textPrimary },

  disciplineInputRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  disciplineInputLabel: { color: RivalColors.textSecondary, fontSize: 14, fontWeight: '600', width: 100 },
  disciplineInput: { flex: 1 },
  distanceSummary: { fontSize: 14, color: RivalColors.accentFill, fontWeight: '700', textAlign: 'right' },
  customDisciplineRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  removeDisc: { color: RivalColors.textSecondary, fontSize: 18, paddingHorizontal: 4 },
  addDisciplineBtn: { paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: RivalColors.surfaceHigh, alignItems: 'center' },
  addDisciplineBtnText: { color: RivalColors.accentFill, fontWeight: '700', fontSize: 14 },

  infoBox: { backgroundColor: RivalColors.surfaceContainer, borderRadius: 10, padding: 14, borderWidth: 1, borderColor: RivalColors.surfaceHigh, gap: 4 },
  infoBoxTitle: { fontSize: 14, fontWeight: '800', color: RivalColors.textPrimary },
  infoBoxText: { fontSize: 12, color: RivalColors.textSecondary, lineHeight: 18 },
  infoBoxAccent: { fontSize: 12, color: RivalColors.accentFill, fontWeight: '700' },

  goalTimeHint: { fontSize: 12, color: RivalColors.textSecondary, fontStyle: 'italic' },

  finishModalCard: { backgroundColor: RivalColors.surfaceContainer, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 28, gap: 12, marginTop: 'auto' },
  finishModalRaceName: { fontSize: 16, color: RivalColors.textSecondary, marginBottom: 4 },
  finishPreviewBox: { backgroundColor: RivalColors.surfaceContainer, borderRadius: 10, padding: 14, borderWidth: 1, borderColor: RivalColors.surfaceHigh },
  finishPreviewMessage: { fontSize: 14, color: RivalColors.textPrimary, fontStyle: 'italic', lineHeight: 20 },
  finishModalHint: { fontSize: 13, color: RivalColors.textSecondary, fontStyle: 'italic' },

  modalButtons: { flexDirection: 'row', gap: 12, marginTop: 8 },
  cancelButton: { flex: 1, paddingVertical: 14, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: RivalColors.surfaceHigh },
  cancelButtonText: { color: RivalColors.textSecondary, fontSize: 16, fontWeight: '600' },
  saveButton: { flex: 2, backgroundColor: RivalColors.accentFill, paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  saveButtonDisabled: { opacity: 0.4 },
  saveButtonText: { color: RivalColors.textPrimary, fontSize: 16, fontWeight: '700' },
});
