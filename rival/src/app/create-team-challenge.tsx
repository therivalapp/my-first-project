// Focused "start a challenge" flow — pick a metric, set a target, pick a
// deadline, confirm. Split out from the old behavior of routing "Start a
// Team Challenge" straight into /league (the unfinished, everything-at-once
// team page) — creating a challenge and viewing one already running are two
// different jobs (see project_rival_team_challenge_concept memory).
//
// Two modes, mutually exclusive per the DB (leagues_goal_or_race_not_both):
// - Team Target: pick a metric + number, deadline via quick presets OR a
//   custom calendar date. Writes goal_metric/goal_target/goal_target_date.
// - Race Goal: the team is training toward an event already on the
//   creator's own /races list (same source create-league.tsx's Journey path
//   uses) — picking one just sets leagues.race_id, no target/metric needed,
//   the race's own date IS the deadline.
// Either way this writes straight onto the existing `leagues` row
// (leagues_team_goal.sql columns) team-hub.tsx already reads, so no new
// schema and team-hub's hero/standings pick it up as-is.
import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '../lib/supabase';
import { RivalIcon, RivalIconName, RivalPageHeader, RivalBackButton } from '../components/rival';
import { RivalColors, RivalRadius, RivalSpacing } from '../constants/rivalTheme';

type GoalMetric = 'xp' | 'distance' | 'elevation' | 'duration' | 'activities';
type Mode = 'target' | 'race';

const METRICS: Array<{ value: GoalMetric; label: string; unit: string; icon: RivalIconName }> = [
  { value: 'distance', label: 'Distance', unit: 'km', icon: 'distance' },
  { value: 'elevation', label: 'Elevation', unit: 'm', icon: 'elevation' },
  { value: 'duration', label: 'Time', unit: 'hrs', icon: 'timerOutline' },
  { value: 'activities', label: 'Activities', unit: 'logged', icon: 'checkCircleOutline' },
  { value: 'xp', label: 'Effort', unit: 'effort', icon: 'bolt' },
];

// Deadlines a team target realistically runs on — a bare date picker asks
// people to do the math themselves; these compute it for them. "Custom"
// drops into the calendar below for anything else.
const DURATIONS: Array<{ label: string; days: number }> = [
  { label: '1 Week', days: 7 },
  { label: '2 Weeks', days: 14 },
  { label: '1 Month', days: 30 },
  { label: '3 Months', days: 90 },
];

type RaceOption = { id: string; name: string; race_date: string; race_type: string | null };

function todayLocalStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function startOfMonth(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1); }
function addMonths(d: Date, n: number): Date { return new Date(d.getFullYear(), d.getMonth() + n, 1); }
function addYears(d: Date, n: number): Date { return new Date(d.getFullYear() + n, d.getMonth(), 1); }
function toIsoDate(d: Date): string { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function monthGridCells(viewDate: Date): (number | null)[] {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const leadingBlanks = firstDow === 0 ? 6 : firstDow - 1;
  const totalDays = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(leadingBlanks).fill(null), ...Array.from({ length: totalDays }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}
function chunkWeeks<T>(cells: T[]): T[][] {
  const weeks: T[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

function MonthCalendarPicker({ value, onChange }: { value: string | null; onChange: (iso: string) => void }) {
  const [viewDate, setViewDate] = useState(() => (value ? new Date(value + 'T00:00:00') : startOfMonth(new Date())));
  const weeks = chunkWeeks(monthGridCells(viewDate));
  const hitSlop = { top: 8, bottom: 8, left: 8, right: 8 };

  return (
    <View style={styles.calendarWidget}>
      <View style={styles.calendarHeaderRow}>
        <View style={styles.calendarNavGroup}>
          <TouchableOpacity onPress={() => setViewDate((d) => addYears(d, -1))} hitSlop={hitSlop}>
            <RivalIcon name="yearBack" size={16} color="rgba(255,255,255,0.6)" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setViewDate((d) => addMonths(d, -1))} hitSlop={hitSlop}>
            <RivalIcon name="monthBack" size={16} color="rgba(255,255,255,0.6)" />
          </TouchableOpacity>
        </View>
        <Text style={styles.calendarMonthLabel}>{viewDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</Text>
        <View style={styles.calendarNavGroup}>
          <TouchableOpacity onPress={() => setViewDate((d) => addMonths(d, 1))} hitSlop={hitSlop}>
            <RivalIcon name="monthForward" size={16} color="rgba(255,255,255,0.6)" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setViewDate((d) => addYears(d, 1))} hitSlop={hitSlop}>
            <RivalIcon name="yearForward" size={16} color="rgba(255,255,255,0.6)" />
          </TouchableOpacity>
        </View>
      </View>
      <View style={styles.calendarDaysRow}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <Text key={i} style={styles.calendarDayLabel}>{d}</Text>
        ))}
      </View>
      {weeks.map((week, wi) => (
        <View key={wi} style={styles.calendarDaysRow}>
          {week.map((day, di) => {
            if (day === null) return <View key={di} style={styles.calendarDayCell} />;
            const cellIso = toIsoDate(new Date(viewDate.getFullYear(), viewDate.getMonth(), day));
            const isSelected = value === cellIso;
            return (
              <TouchableOpacity key={di} style={[styles.calendarDayCell, isSelected && styles.calendarDayCellActive]} onPress={() => onChange(cellIso)}>
                <Text style={[styles.calendarDayNum, isSelected && styles.calendarDayNumActive]}>{day}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );
}

export default function CreateTeamChallenge() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [mode, setMode] = useState<Mode>('target');

  // Team Target state
  const [metric, setMetric] = useState<GoalMetric>('distance');
  const [target, setTarget] = useState('');
  const [duration, setDuration] = useState<number | 'custom'>(30);
  const [customDate, setCustomDate] = useState<string | null>(null);

  // Race Goal state
  const [myRaces, setMyRaces] = useState<RaceOption[]>([]);
  const [selectedRaceId, setSelectedRaceId] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedMetric = METRICS.find((m) => m.value === metric)!;

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('races')
        .select('id, name, race_date, race_type')
        .eq('user_id', user.id)
        .gte('race_date', todayLocalStr())
        .order('race_date', { ascending: true });
      setMyRaces(data ?? []);
    })();
  }, []);

  async function handleCreate() {
    if (!id) return;
    setError(null);

    if (mode === 'race') {
      if (!selectedRaceId) {
        setError('Pick a race to work toward.');
        return;
      }
      setSaving(true);
      const { error: dbErr } = await supabase
        .from('leagues')
        .update({ race_id: selectedRaceId, goal_metric: null, goal_target: null, goal_target_date: null })
        .eq('id', id);
      setSaving(false);
      if (dbErr) { setError(dbErr.message); return; }
      router.replace({ pathname: '/team-hub', params: { id } });
      return;
    }

    const numTarget = parseFloat(target);
    if (!numTarget || numTarget <= 0) {
      setError('Enter a target above 0.');
      return;
    }
    let goalTargetDate: string;
    if (duration === 'custom') {
      if (!customDate) { setError('Pick a date on the calendar.'); return; }
      goalTargetDate = customDate;
    } else {
      const d = new Date();
      d.setDate(d.getDate() + duration);
      goalTargetDate = toIsoDate(d);
    }

    setSaving(true);
    const { error: dbErr } = await supabase
      .from('leagues')
      .update({ goal_metric: metric, goal_target: numTarget, goal_target_date: goalTargetDate, race_id: null })
      .eq('id', id);

    setSaving(false);
    if (dbErr) { setError(dbErr.message); return; }
    router.replace({ pathname: '/team-hub', params: { id } });
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <View style={styles.topRow}>
        <RivalBackButton onPress={() => router.back()} style={styles.backBtn} />
      </View>

      <RivalPageHeader title="Start a Team Challenge" subtitle="One shared number, everyone's effort counts toward it." />

      <View style={styles.body}>
        <View style={styles.modeRow}>
          <TouchableOpacity style={[styles.modeTab, mode === 'target' && styles.modeTabActive]} onPress={() => setMode('target')}>
            <Text style={[styles.modeTabText, mode === 'target' && styles.modeTabTextActive]}>Team Target</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.modeTab, mode === 'race' && styles.modeTabActive]} onPress={() => setMode('race')}>
            <Text style={[styles.modeTabText, mode === 'race' && styles.modeTabTextActive]}>Working Toward a Race</Text>
          </TouchableOpacity>
        </View>

        {mode === 'target' ? (
          <>
            <Text style={styles.label}>What are you chasing?</Text>
            <View style={styles.metricRow}>
              {METRICS.map((m) => (
                <TouchableOpacity
                  key={m.value}
                  style={[styles.metricChip, metric === m.value && styles.metricChipActive]}
                  onPress={() => setMetric(m.value)}
                >
                  <RivalIcon name={m.icon} size={16} color={metric === m.value ? RivalColors.onAccentFill : RivalColors.accentText} />
                  <Text style={[styles.metricChipText, metric === m.value && styles.metricChipTextActive]}>{m.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Target</Text>
            <View style={styles.targetRow}>
              <View style={styles.targetInputWrap}>
                <TextInput
                  style={styles.targetInput}
                  placeholder="e.g. 1000"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  value={target}
                  onChangeText={setTarget}
                  keyboardType="decimal-pad"
                />
              </View>
              <Text style={styles.targetUnit}>{selectedMetric.unit}</Text>
            </View>

            <Text style={styles.label}>Complete By</Text>
            <View style={styles.durationRow}>
              {DURATIONS.map((d) => (
                <TouchableOpacity
                  key={d.days}
                  style={[styles.durationChip, duration === d.days && styles.durationChipActive]}
                  onPress={() => setDuration(d.days)}
                >
                  <Text style={[styles.durationChipText, duration === d.days && styles.durationChipTextActive]}>{d.label}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={[styles.durationChip, duration === 'custom' && styles.durationChipActive]}
                onPress={() => setDuration('custom')}
              >
                <Text style={[styles.durationChipText, duration === 'custom' && styles.durationChipTextActive]}>Custom Date</Text>
              </TouchableOpacity>
            </View>

            {duration === 'custom' && (
              <View style={styles.dateCard}>
                <Text style={[styles.selectedDateText, !customDate && styles.selectedDateTextEmpty]}>
                  {customDate ? new Date(customDate + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : 'No date selected yet'}
                </Text>
                <MonthCalendarPicker value={customDate} onChange={setCustomDate} />
              </View>
            )}
          </>
        ) : (
          <>
            <Text style={styles.label}>Which race?</Text>
            {myRaces.length === 0 ? (
              <Text style={styles.emptyRaceText}>No upcoming races on your profile yet — add one from Races first.</Text>
            ) : (
              <View style={{ gap: 8 }}>
                {myRaces.map((r) => (
                  <TouchableOpacity
                    key={r.id}
                    style={[styles.raceRow, selectedRaceId === r.id && styles.raceRowActive]}
                    onPress={() => setSelectedRaceId(r.id)}
                  >
                    <RivalIcon name="flag" size={16} color={selectedRaceId === r.id ? RivalColors.onAccentFill : '#ff5c5c'} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.raceRowName, selectedRaceId === r.id && styles.raceRowTextActive]}>{r.name}</Text>
                      <Text style={[styles.raceRowDate, selectedRaceId === r.id && styles.raceRowTextActive]}>
                        {new Date(r.race_date + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity style={[styles.createBtn, saving && styles.createBtnDisabled]} onPress={handleCreate} disabled={saving}>
          <Text style={styles.createBtnText}>{saving ? 'Starting…' : 'Start Challenge'}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#131313' },
  topRow: { paddingHorizontal: RivalSpacing.gutter, paddingTop: 8 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: RivalSpacing.gutter, paddingBottom: 40, maxWidth: 480, width: '100%', alignSelf: 'center' },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)', marginTop: 24, marginBottom: 10 },

  modeRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  modeTab: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: RivalRadius.DEFAULT, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: 'rgba(255,255,255,0.04)' },
  modeTabActive: { backgroundColor: RivalColors.accentFill, borderColor: RivalColors.accentFill },
  modeTabText: { fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.6)' },
  modeTabTextActive: { color: RivalColors.onAccentFill },

  metricRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metricChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: RivalRadius.full, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 14, paddingVertical: 9, backgroundColor: 'rgba(255,255,255,0.04)',
  },
  metricChipActive: { backgroundColor: RivalColors.accentFill, borderColor: RivalColors.accentFill },
  metricChipText: { fontSize: 13, fontWeight: '600', color: RivalColors.accentText },
  metricChipTextActive: { color: RivalColors.onAccentFill },

  targetRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  targetInputWrap: { flex: 1 },
  targetInput: {
    borderRadius: RivalRadius.DEFAULT, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.04)', paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, fontWeight: '700', color: '#fff',
  },
  targetUnit: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.5)', minWidth: 56 },

  durationRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  durationChip: {
    borderRadius: RivalRadius.full, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 16, paddingVertical: 9, backgroundColor: 'rgba(255,255,255,0.04)',
  },
  durationChipActive: { backgroundColor: RivalColors.accentFill, borderColor: RivalColors.accentFill },
  durationChipText: { fontSize: 13, fontWeight: '600', color: RivalColors.accentText },
  durationChipTextActive: { color: RivalColors.onAccentFill },

  dateCard: { backgroundColor: 'rgba(0,0,0,0.38)', borderRadius: RivalRadius.DEFAULT, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', padding: 14, gap: 8, marginTop: 14 },
  selectedDateText: { fontSize: 14, fontWeight: '700', color: '#fff', textAlign: 'center' },
  selectedDateTextEmpty: { fontWeight: '400', color: 'rgba(255,255,255,0.4)' },

  calendarWidget: { marginTop: 10, gap: 6, width: '100%' },
  calendarHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  calendarNavGroup: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  calendarMonthLabel: { fontSize: 12, fontWeight: '700', color: '#fff' },
  calendarDaysRow: { flexDirection: 'row', gap: 2 },
  calendarDayLabel: { flex: 1, textAlign: 'center', fontSize: 9, fontWeight: '700', color: 'rgba(255,255,255,0.4)' },
  calendarDayCell: { flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: RivalRadius.sm, borderWidth: 1, borderColor: 'transparent' },
  calendarDayCellActive: { backgroundColor: 'rgba(217,119,87,0.18)', borderColor: RivalColors.accentFill },
  calendarDayNum: { fontSize: 11, color: 'rgba(255,255,255,0.7)' },
  calendarDayNumActive: { color: RivalColors.accentText, fontWeight: '700' },

  emptyRaceText: { fontSize: 13, color: 'rgba(255,255,255,0.5)', lineHeight: 18 },
  raceRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: RivalRadius.DEFAULT, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.04)', padding: 14,
  },
  raceRowActive: { backgroundColor: RivalColors.accentFill, borderColor: RivalColors.accentFill },
  raceRowName: { fontSize: 14, fontWeight: '700', color: '#fff' },
  raceRowDate: { fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 2 },
  raceRowTextActive: { color: RivalColors.onAccentFill },

  error: { color: '#ff6b6b', fontSize: 13, marginTop: 20, textAlign: 'center' },

  createBtn: { marginTop: 32, backgroundColor: RivalColors.accentFill, borderRadius: RivalRadius.full, paddingVertical: 16, alignItems: 'center' },
  createBtnDisabled: { opacity: 0.6 },
  createBtnText: { fontSize: 15, fontWeight: '800', letterSpacing: 0.5, color: RivalColors.onAccentFill, textTransform: 'uppercase' },
});
