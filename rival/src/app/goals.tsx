import { useState, useCallback } from 'react';
import { StyleSheet, TouchableOpacity, View, Text, ScrollView, TextInput, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { supabase } from '../lib/supabase';
import { displayToIsoDate } from '../lib/dateFormat';
import { computeGoalProgress } from '../lib/goalProgress';
import { notify } from '../lib/notify';
import { RivalTopNav, RivalIcon, RivalPageHeader } from '../components/rival';
import { RivalColors, RivalRadius, RivalSerifFamily } from '../constants/rivalTheme';

type Goal = {
  id: string;
  goal_type: 'distance' | 'elevation' | 'gym_sessions';
  target_value: number;
  period_type: 'week' | 'month' | 'custom';
  start_date: string;
  end_date: string;
  activity_filter: string | null;
  progress: number;
  pinned: boolean;
};

const GOAL_LABELS: Record<string, string> = {
  distance: 'Distance',
  elevation: 'Elevation',
  gym_sessions: 'Gym Sessions',
};

const GOAL_UNITS: Record<string, string> = {
  distance: 'km',
  elevation: 'm',
  gym_sessions: 'sessions',
};

const GOAL_ABBR: Record<string, string> = {
  distance: 'KM',
  elevation: 'ELEV',
  gym_sessions: 'GYM',
};

const GOAL_BAR_COLOR: Record<string, string> = {
  distance: RivalColors.accentText,
  elevation: RivalColors.accentFill,
  gym_sessions: RivalColors.accentFill,
};

// Activity types available as filters, with display names
const DISTANCE_FILTERS = [
  { value: null, label: 'All' },
  { value: 'Run', label: 'Run' },
  { value: 'Ride', label: 'Ride' },
  { value: 'Swim', label: 'Swim' },
  { value: 'Walk', label: 'Walk' },
  { value: 'Hike', label: 'Hike' },
];

const ELEVATION_FILTERS = [
  { value: null, label: 'All' },
  { value: 'Run', label: 'Run' },
  { value: 'Ride', label: 'Ride' },
  { value: 'Hike', label: 'Hike' },
];

function activityLabel(filter: string | null) {
  if (!filter) return 'All activities';
  return filter;
}

function getMondayStart(date: Date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getMonthStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function dateToLocalStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getNiceInterval(target: number): number {
  const niceNumbers = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
  const rough = target / 8;
  return niceNumbers.find((n) => n >= rough) ?? niceNumbers[niceNumbers.length - 1];
}

const ZERO_MESSAGES = [
  "Let's do this! Time to get moving.",
  "You got this. First one's always the hardest.",
  "Goal set. Now go earn it.",
  "Ready when you are. Let's get it.",
  "Today's the day. No better time than now.",
  "Your future self will thank you.",
  "Go get those endorphins!",
];

// A week/month goal whose end_date has passed without being hit — the DB row
// itself never renews (see saveGoal), so without this it just silently
// disappears from "active" everywhere (home.tsx's featured-goal card, this
// list) with no record of it ever existing. Brand voice: never frame it as
// failure — "missed"/"expired" reads as shame, not encouragement.
function isGoalEnded(goal: Goal): boolean {
  if (goal.period_type === 'custom') return false; // one-off deadline, not a recurring period — no natural "try again"
  const end = new Date(goal.end_date + 'T23:59:59');
  return end.getTime() < Date.now() && goal.progress < goal.target_value;
}

function endedMessage(goal: Goal): string {
  const unit = GOAL_UNITS[goal.goal_type];
  const remaining = Math.round((goal.target_value - goal.progress) * 10) / 10;
  const period = goal.period_type === 'week' ? 'this week' : 'this month';
  return `You were ${remaining} ${unit} away from finishing your previous goal. Let's try again ${period} — you got this.`;
}

function getEncouragement(progress: number, target: number, unit: string, goalId: string): string | null {
  const pct = progress / target;
  if (pct <= 0) {
    // Pick a consistent message per goal using the id
    const idx = goalId.charCodeAt(0) % ZERO_MESSAGES.length;
    return ZERO_MESSAGES[idx];
  }
  const remaining = Math.round((target - progress) * 10) / 10;
  if (remaining <= 0) return null;
  if (remaining <= target * 0.05) return `Almost there — just ${remaining} ${unit} to go!`;
  if (remaining <= target * 0.15) return `So close! Only ${remaining} ${unit} left.`;
  if (pct >= 0.75) return `Nearly there — ${remaining} ${unit} to go. Keep pushing!`;
  if (pct >= 0.5) return `Great work, you're over halfway! ${remaining} ${unit} remaining.`;
  if (pct >= 0.25) return `Good progress! ${remaining} ${unit} to go.`;
  return `Keep it up — ${remaining} ${unit} to go!`;
}

function ProgressBar({
  progress,
  target,
  color,
  unit,
}: {
  progress: number;
  target: number;
  color: string;
  unit: string;
}) {
  const rawPct = progress / target;
  const pct = Math.min(rawPct, 1);
  const displayPct = Math.round(pct * 100);
  const done = rawPct >= 1;

  // Thumb: at 0% pin to left edge, at 100% pin to right edge, otherwise center on position
  const thumbStyle = done
    ? { right: 0, left: undefined as any, marginLeft: 0 }
    : pct === 0
    ? { left: 0 as any, marginLeft: 0 }
    : { left: `${pct * 100}%` as any, marginLeft: -9 };

  const interval = getNiceInterval(target);
  const checkpoints: number[] = [];
  for (let v = interval; v < target; v += interval) {
    checkpoints.push(v);
  }

  return (
    <View style={styles.barContainer}>
      {checkpoints.length > 0 && (
        <View style={styles.checkpointLabelRow}>
          {checkpoints.map((cp) => {
            const cpPct = (cp / target) * 100;
            const reached = progress >= cp;
            return (
              <View key={cp} style={[styles.checkpointLabel, { left: `${cpPct}%` }]}>
                <Text style={[styles.checkpointLabelText, reached && { color }]}>
                  {cp >= 1000 ? `${cp / 1000}k` : cp}
                </Text>
              </View>
            );
          })}
        </View>
      )}

      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: done ? '100%' : `${pct * 100}%`, backgroundColor: color }]} />

        {checkpoints.map((cp) => {
          const cpPct = (cp / target) * 100;
          const reached = progress >= cp;
          return (
            <View
              key={cp}
              style={[styles.tick, { left: `${cpPct}%`, backgroundColor: reached ? RivalColors.textPrimary : 'rgba(255,181,158,0.45)' }]}
            />
          );
        })}

        <View style={[styles.thumb, thumbStyle, { borderColor: done ? RivalColors.accentGold : color, backgroundColor: done ? RivalColors.accentGold : RivalColors.textPrimary }]} />
      </View>

      <View style={styles.barLabels}>
        <Text style={styles.barLabelStart}>0</Text>
        <Text style={[styles.barLabelProgress, { color: done ? RivalColors.accentGold : color }]}>{displayPct}%</Text>
        <Text style={styles.barLabelEnd}>{target}</Text>
      </View>
    </View>
  );
}

export default function GoalsScreen() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [userId, setUserId] = useState('');

  const [goalType, setGoalType] = useState<'distance' | 'elevation' | 'gym_sessions'>('distance');
  const [targetValue, setTargetValue] = useState('');
  const [periodType, setPeriodType] = useState<'week' | 'month' | 'custom'>('month');
  const [customEndDate, setCustomEndDate] = useState('');
  const [activityFilter, setActivityFilter] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useFocusEffect(useCallback(() => { load(); }, []));

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);

    const { data: goalsData } = await supabase
      .from('goals')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (!goalsData) { setLoading(false); return; }

    const { data: activities } = await supabase
      .from('activities')
      .select('activity_type, distance_meters, elevation_meters, started_at')
      .eq('user_id', user.id);

    const goalsWithProgress = goalsData.map((goal: any) => ({
      ...goal,
      progress: computeGoalProgress(goal, activities || []),
    }));

    setGoals(goalsWithProgress);
    setLoading(false);
  }

  function getDateRange(period: 'week' | 'month' | 'custom') {
    const now = new Date();
    if (period === 'week') {
      const start = getMondayStart(now);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      return { start, end };
    }
    if (period === 'month') {
      const start = getMonthStart(now);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { start, end };
    }
    const start = now;
    const customIso = customEndDate ? displayToIsoDate(customEndDate) : null;
    const end = customIso
      ? (() => { const [y, m, d] = customIso.split('-').map(Number); return new Date(y, m - 1, d); })()
      : now;
    return { start, end };
  }

  async function saveGoal() {
    if (!targetValue || parseFloat(targetValue) <= 0) return;
    if (goals.length >= 3) return;
    if (periodType === 'custom' && (!customEndDate || !displayToIsoDate(customEndDate))) return;

    setSaving(true);
    const { start, end } = getDateRange(periodType);

    const { error: addErr } = await supabase.from('goals').insert({
      user_id: userId,
      goal_type: goalType,
      target_value: parseFloat(targetValue),
      period_type: periodType,
      start_date: dateToLocalStr(start),
      end_date: dateToLocalStr(end),
      activity_filter: goalType === 'gym_sessions' ? null : activityFilter,
    });
    if (addErr) {
      // Keep the form open with the values still in it rather than closing on
      // a goal that was never created.
      notify("Couldn't create that goal", addErr.message);
      setSaving(false);
      return;
    }

    setSaving(false);
    setShowAdd(false);
    setTargetValue('');
    setPeriodType('month');
    setCustomEndDate('');
    setGoalType('distance');
    setActivityFilter(null);
    load();
  }

  async function deleteGoal(id: string) {
    if (typeof window !== 'undefined' && !window.confirm('Delete this goal?')) return;
    const { error } = await supabase.from('goals').delete().eq('id', id);
    if (error) {
      notify("Couldn't delete that goal", error.message);
      return;
    }
    setGoals((prev) => prev.filter((g) => g.id !== id));
  }

  // Exactly one pinned goal at a time — pinning this one unpins whichever
  // else was pinned, in the same round trip. This is what home.tsx's Today
  // card reads to decide which goal to feature, ahead of the nearest-
  // deadline auto-pick fallback.
  async function togglePin(goal: Goal) {
    const nextPinned = !goal.pinned;
    setGoals((prev) => prev.map((g) => ({ ...g, pinned: g.id === goal.id ? nextPinned : false })));
    if (nextPinned) {
      const { error: unpinError } = await supabase.from('goals').update({ pinned: false }).eq('user_id', userId).neq('id', goal.id);
      if (unpinError) { load(); return; }
    }
    const { error } = await supabase.from('goals').update({ pinned: nextPinned }).eq('id', goal.id);
    if (error) load();
  }

  // Replaces an ended goal with a fresh one for the current week/month —
  // same type/target/filter, reset progress. Replaces rather than stacking
  // a 4th row, since it's the same slot picking back up, not a new goal.
  async function tryAgainGoal(goal: Goal) {
    const { start, end } = getDateRange(goal.period_type as 'week' | 'month');
    // Insert the replacement BEFORE removing the old row, and abort if it
    // fails: unchecked, a failed insert followed by a successful delete left
    // the athlete with no goal at all -- silent data loss on a button labelled
    // "try again".
    const { error: insErr } = await supabase.from('goals').insert({
      user_id: userId,
      goal_type: goal.goal_type,
      target_value: goal.target_value,
      period_type: goal.period_type,
      start_date: dateToLocalStr(start),
      end_date: dateToLocalStr(end),
      activity_filter: goal.activity_filter,
    });
    if (insErr) {
      notify("Couldn't start that goal again", insErr.message);
      return;
    }
    const { error: delErr } = await supabase.from('goals').delete().eq('id', goal.id);
    if (delErr) {
      // The new goal exists, so nothing is lost; the old one just lingers.
      notify('Started a fresh goal', 'The finished one could not be cleared away — you may see both for now.');
    }
    load();
  }

  function periodLabel(goal: Goal) {
    if (goal.period_type === 'week') return 'This week';
    if (goal.period_type === 'month') return 'This month';
    return `${formatDate(goal.start_date)} – ${formatDate(goal.end_date)}`;
  }

  const filterOptions = goalType === 'elevation' ? ELEVATION_FILTERS : DISTANCE_FILTERS;

  return (
    <SafeAreaView style={styles.container}>
      <RivalTopNav active="today" />
      <ScrollView contentContainerStyle={styles.content}>

        <View style={styles.header}>
          <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/home'))}>
            <Text style={styles.back}>← Back</Text>
          </TouchableOpacity>
        </View>

        <RivalPageHeader title="Goals" subtitle="Track what you're working towards." />

        {loading && <Text style={styles.emptyText}>Loading…</Text>}

        {!loading && goals.length === 0 && (
          <Text style={styles.emptyText}>No goals yet. Set one below.</Text>
        )}

        {goals.map((goal) => {
          const color = GOAL_BAR_COLOR[goal.goal_type];
          const unit = GOAL_UNITS[goal.goal_type];
          const done = goal.progress >= goal.target_value;
          const ended = !done && isGoalEnded(goal);
          const encouragement = getEncouragement(goal.progress, goal.target_value, unit, goal.id);
          return (
            <View
              key={goal.id}
              style={[
                styles.goalCard,
                done && { borderColor: RivalColors.accentGold, borderWidth: 1.5 },
              ]}
            >
              <View style={styles.goalHeader}>
                <View style={styles.goalTitleRow}>
                  <View style={[styles.typeBadge, { backgroundColor: color + '22', borderColor: color + '55' }]}>
                    <Text style={[styles.typeBadgeText, { color }]}>{GOAL_ABBR[goal.goal_type]}</Text>
                  </View>
                  <View>
                    <Text style={styles.goalTitle}>{activityLabel(goal.activity_filter)}</Text>
                    <Text style={styles.goalPeriod}>
                      {GOAL_LABELS[goal.goal_type]} · {periodLabel(goal)}
                    </Text>
                  </View>
                </View>
                <View style={styles.goalHeaderActions}>
                  <TouchableOpacity onPress={() => togglePin(goal)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <RivalIcon name="pin" size={18} color={goal.pinned ? RivalColors.accentText : RivalColors.textSecondary} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => deleteGoal(goal.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <View style={styles.deleteBtn}>
                      <Text style={styles.deleteBtnText}>✕</Text>
                    </View>
                  </TouchableOpacity>
                </View>
              </View>
              {goal.pinned && <Text style={styles.pinnedLabel}>Pinned to Today</Text>}

              {done && (
                <View style={styles.celebrationBanner}>
                  <Text style={styles.celebrationText}>Goal complete!</Text>
                  <Text style={styles.celebrationSub}>You crushed it. Set a new one to keep the momentum going.</Text>
                </View>
              )}

              <View style={styles.goalProgress}>
                <Text style={[styles.progressCurrent, done && { color: RivalColors.accentGold }]}>{goal.progress}</Text>
                <Text style={styles.progressSep}> / </Text>
                <Text style={styles.progressTarget}>{goal.target_value} {unit}</Text>
              </View>

              <ProgressBar
                progress={goal.progress}
                target={goal.target_value}
                color={color}
                unit={unit}
              />

              {!done && !ended && encouragement && (
                <Text style={styles.encouragement}>{encouragement}</Text>
              )}

              {ended && (
                <View style={styles.endedBlock}>
                  <Text style={styles.encouragement}>{endedMessage(goal)}</Text>
                  <TouchableOpacity style={styles.tryAgainBtn} onPress={() => tryAgainGoal(goal)}>
                    <Text style={styles.tryAgainBtnText}>Try again {goal.period_type === 'week' ? 'this week' : 'this month'}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        })}

        {goals.length < 3 && (
          <TouchableOpacity style={styles.addButton} onPress={() => setShowAdd(true)}>
            <Text style={styles.addButtonText}>+ Add Goal</Text>
          </TouchableOpacity>
        )}

        {goals.length >= 3 && (
          <Text style={styles.maxText}>Maximum 3 goals. Delete one to add another.</Text>
        )}

      </ScrollView>

      <Modal visible={showAdd} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalCard}>
            <Text style={styles.modalTitle}>New Goal</Text>

            <Text style={styles.modalLabel}>Type</Text>
            <View style={styles.segmentRow}>
              {(['distance', 'elevation', 'gym_sessions'] as const).map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[styles.segment, goalType === t && styles.segmentActive]}
                  onPress={() => { setGoalType(t); setActivityFilter(null); }}
                >
                  <Text style={[styles.segmentText, goalType === t && styles.segmentTextActive]}>
                    {GOAL_LABELS[t]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {goalType !== 'gym_sessions' && (
              <>
                <Text style={styles.modalLabel}>Activity</Text>
                <View style={styles.segmentRow}>
                  {filterOptions.map((opt) => (
                    <TouchableOpacity
                      key={String(opt.value)}
                      style={[styles.segment, activityFilter === opt.value && styles.segmentActive]}
                      onPress={() => setActivityFilter(opt.value)}
                    >
                      <Text style={[styles.segmentText, activityFilter === opt.value && styles.segmentTextActive]}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            <Text style={styles.modalLabel}>Target ({GOAL_UNITS[goalType]})</Text>
            <TextInput
              style={styles.modalInput}
              placeholder={goalType === 'distance' ? '100' : goalType === 'elevation' ? '5000' : '12'}
              placeholderTextColor={RivalColors.textSecondary}
              value={targetValue}
              onChangeText={setTargetValue}
              keyboardType="decimal-pad"
            />

            <Text style={styles.modalLabel}>Period</Text>
            <View style={styles.segmentRow}>
              {(['week', 'month', 'custom'] as const).map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[styles.segment, periodType === p && styles.segmentActive]}
                  onPress={() => setPeriodType(p)}
                >
                  <Text style={[styles.segmentText, periodType === p && styles.segmentTextActive]}>
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {periodType === 'custom' && (
              <>
                <Text style={styles.modalLabel}>End date (DD/MM/YYYY)</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="31/12/2026"
                  placeholderTextColor={RivalColors.textSecondary}
                  value={customEndDate}
                  onChangeText={setCustomEndDate}
                  keyboardType="numbers-and-punctuation"
                />
              </>
            )}

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => { setShowAdd(false); setTargetValue(''); setActivityFilter(null); }}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveButton, (!targetValue || saving) && styles.saveButtonDisabled]}
                onPress={saveGoal}
                disabled={!targetValue || saving}
              >
                <Text style={styles.saveButtonText}>{saving ? 'Saving…' : 'Save Goal'}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: RivalColors.surfaceLow },
  content: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 40 },
  header: { marginBottom: 24 },
  back: { color: RivalColors.accentFill, fontSize: 16 },
  title: { fontSize: 32, fontWeight: '900', color: RivalColors.textPrimary, marginBottom: 4 },
  subtitle: { fontSize: 14, color: RivalColors.textSecondary, marginBottom: 28 },
  emptyText: { color: RivalColors.textSecondary, fontSize: 15, textAlign: 'center', paddingVertical: 24 },
  goalCard: {
    backgroundColor: RivalColors.surfaceContainer,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: RivalColors.surfaceHigh,
  },
  goalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  goalTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  goalHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  pinnedLabel: { fontSize: 11, fontWeight: '700', color: RivalColors.accentText, marginTop: -8, marginBottom: 10 },
  typeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
  },
  typeBadgeText: { fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  goalTitle: { fontSize: 17, fontWeight: '800', color: RivalColors.textPrimary },
  goalPeriod: { fontSize: 12, color: RivalColors.textSecondary, marginTop: 2 },
  deleteBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: RivalColors.surfaceContainer,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtnText: { color: RivalColors.textSecondary, fontSize: 12, fontWeight: '700' },
  celebrationBanner: {
    backgroundColor: 'rgba(245,183,89,0.12)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(245,183,89,0.25)',
    padding: 12,
    marginBottom: 14,
  },
  celebrationText: {
    fontSize: 15,
    fontWeight: '800',
    color: RivalColors.accentGold,
    marginBottom: 2,
  },
  celebrationSub: {
    fontSize: 12,
    color: RivalColors.accentGold,
    opacity: 0.8,
  },
  encouragement: {
    fontSize: 16,
    fontWeight: '700',
    color: RivalColors.textSecondary,
    marginTop: 10,
    fontStyle: 'italic',
  },
  endedBlock: { marginTop: 10, gap: 10 },
  tryAgainBtn: {
    backgroundColor: RivalColors.accentFill, borderRadius: RivalRadius.full,
    paddingVertical: 10, alignItems: 'center',
  },
  tryAgainBtnText: { fontSize: 14, fontWeight: '700', color: RivalColors.onAccentFill },
  goalProgress: { flexDirection: 'row', alignItems: 'baseline', marginBottom: 20 },
  // Display number — the editorial serif, matching Today's Focus card.
  progressCurrent: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 30, fontWeight: '700', color: RivalColors.textPrimary },
  progressSep: { color: RivalColors.textSecondary, fontSize: 16 },
  progressTarget: { color: RivalColors.textSecondary, fontSize: 15 },
  barContainer: { gap: 0 },
  checkpointLabelRow: {
    position: 'relative',
    height: 16,
    marginBottom: 2,
  },
  checkpointLabel: {
    position: 'absolute',
    transform: [{ translateX: -10 }],
  },
  checkpointLabelText: {
    fontSize: 9,
    color: RivalColors.accentText,
    fontWeight: '700',
  },
  barTrack: {
    height: 10,
    backgroundColor: RivalColors.surfaceHigh,
    borderRadius: 5,
    position: 'relative',
    overflow: 'visible',
  },
  barFill: {
    height: '100%',
    borderRadius: 5,
    minWidth: 0,
  },
  tick: {
    position: 'absolute',
    top: 0,
    width: 2,
    height: '100%',
    marginLeft: -1,
  },
  thumb: {
    position: 'absolute',
    top: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: RivalColors.textPrimary,
    borderWidth: 3,
    marginLeft: -9,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
  },
  barLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  barLabelStart: { fontSize: 11, color: RivalColors.textSecondary },
  barLabelProgress: { fontSize: 11, fontWeight: '700' },
  barLabelEnd: { fontSize: 11, color: RivalColors.textSecondary },
  addButton: {
    backgroundColor: RivalColors.accentFill,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  addButtonText: { color: RivalColors.textPrimary, fontSize: 18, fontWeight: '700' },
  maxText: { color: RivalColors.textSecondary, fontSize: 13, textAlign: 'center', marginTop: 16 },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalScroll: {
    maxHeight: '85%',
  },
  modalCard: {
    backgroundColor: RivalColors.surfaceContainer,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 28,
    gap: 12,
  },
  modalTitle: { fontSize: 22, fontWeight: '900', color: RivalColors.textPrimary, marginBottom: 4 },
  modalLabel: { fontSize: 12, fontWeight: '700', color: RivalColors.textSecondary, textTransform: 'uppercase', letterSpacing: 1 },
  segmentRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  segment: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: RivalColors.surfaceHigh,
    backgroundColor: RivalColors.surfaceContainer,
  },
  segmentActive: { backgroundColor: RivalColors.accentFill, borderColor: RivalColors.accentFill },
  segmentText: { color: RivalColors.textSecondary, fontSize: 13, fontWeight: '600' },
  segmentTextActive: { color: RivalColors.textPrimary },
  modalInput: {
    backgroundColor: RivalColors.surfaceContainer,
    borderRadius: 10,
    padding: 14,
    color: RivalColors.textPrimary,
    fontSize: 16,
    borderWidth: 1,
    borderColor: RivalColors.surfaceHigh,
  },
  modalButtons: { flexDirection: 'row', gap: 12, marginTop: 8 },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: RivalColors.surfaceHigh,
  },
  cancelButtonText: { color: RivalColors.textSecondary, fontSize: 16, fontWeight: '600' },
  saveButton: {
    flex: 2,
    backgroundColor: RivalColors.accentFill,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  saveButtonDisabled: { opacity: 0.4 },
  saveButtonText: { color: RivalColors.textPrimary, fontSize: 16, fontWeight: '700' },
});
