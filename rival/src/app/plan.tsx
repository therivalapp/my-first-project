import { useEffect, useState, useCallback } from 'react';
import { RivalColors } from '../constants/rivalTheme';
import { StyleSheet, TouchableOpacity, View, Text, ScrollView, TextInput, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { supabase } from '../lib/supabase';
import { formatDisplayName, formatTeamName } from '../lib/identity';
import { ACTIVITY_ICONS } from '../constants/activityIcons';
import { RivalTopNav, RivalPageHeader } from '../components/rival';

// Class-based types use sessions (1 session = 45 min) instead of free duration entry
const SESSION_TYPES = new Set([
  'WeightTraining', 'CrossFit', 'Hyrox', 'HIIT', 'Workout', 'Yoga',
]);
const SESSION_MINUTES = 45;

type PlannedActivity = {
  id: string;
  activity_type: string;
  duration_minutes: number;
  projected_xp: number;
};

type LeagueStanding = {
  league_id: string;
  league_name: string;
  currentRank: number;
  projectedRank: number;
  myCurrentScore: number;
  myProjectedScore: number;
  members: { user_id: string; name: string; score: number }[];
};

function getMondayStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function PlanScreen() {
  const [userId, setUserId] = useState('');
  const [scoringConfig, setScoringConfig] = useState<Record<string, number>>({});
  const [activityTypes, setActivityTypes] = useState<string[]>([]);
  const [currentWeekXp, setCurrentWeekXp] = useState(0);
  const [plannedActivities, setPlannedActivities] = useState<PlannedActivity[]>([]);
  const [leagues, setLeagues] = useState<LeagueStanding[]>([]);
  const [loading, setLoading] = useState(true);

  // Add modal
  const [showAdd, setShowAdd] = useState(false);
  const [selectedType, setSelectedType] = useState('Run');
  const [duration, setDuration] = useState('');
  const [sessions, setSessions] = useState(1);

  useFocusEffect(useCallback(() => { load(); }, []));

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);

    const weekStart = getMondayStart(new Date());
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);

    const [configRes, activitiesRes, membershipsRes] = await Promise.all([
      supabase.from('scoring_config').select('activity_type, multiplier'),
      supabase.from('activities').select('effort_score, started_at')
        .eq('user_id', user.id)
        .gte('started_at', weekStart.toISOString())
        .lt('started_at', weekEnd.toISOString()),
      supabase.from('league_members').select('league_id, leagues(id, name)').eq('user_id', user.id).eq('status', 'active'),
    ]);

    // Build scoring map
    const config: Record<string, number> = {};
    for (const row of configRes.data || []) {
      config[row.activity_type] = row.multiplier;
    }
    setScoringConfig(config);
    setActivityTypes(Object.keys(config).sort());

    // Current week XP
    const weekTotal = (activitiesRes.data || []).reduce((s, a) => s + (a.effort_score || 0), 0);
    setCurrentWeekXp(Math.round(weekTotal * 10) / 10);

    // League standings
    const leagueMemberships = (membershipsRes.data || []).map((m: any) => m.leagues).filter(Boolean);
    // Two queries total, not one per league plus one per member of every
    // league. This was nested fan-out: four teams of fifteen meant sixty-one
    // requests before the plan could render.
    const leagueIds = leagueMemberships.map((l: any) => l.id);
    let leagueStandings: LeagueStanding[] = [];

    if (leagueIds.length > 0) {
      const { data: allMembers } = await supabase
        .from('league_members')
        .select('league_id, user_id, users(display_name, email, username, display_style)')
        .in('league_id', leagueIds)
        .eq('status', 'active');

      const everyMemberId = Array.from(new Set((allMembers || []).map((m: any) => m.user_id)));
      const { data: acts } = everyMemberId.length
        ? await supabase
            .from('activities').select('user_id, effort_score')
            .in('user_id', everyMemberId)
            .gte('started_at', weekStart.toISOString())
            .lt('started_at', weekEnd.toISOString())
        : { data: [] as any[] };

      const scoreByUser: Record<string, number> = {};
      (acts || []).forEach((a: any) => {
        scoreByUser[a.user_id] = (scoreByUser[a.user_id] || 0) + (a.effort_score || 0);
      });

      const membersByLeague: Record<string, any[]> = {};
      (allMembers || []).forEach((m: any) => {
        (membersByLeague[m.league_id] ||= []).push(m);
      });

      leagueStandings = leagueMemberships.map((league: any) => {
        const members = (membersByLeague[league.id] || []).map((m: any) => ({
          user_id: m.user_id,
          name: formatDisplayName(m.users),
          score: Math.round((scoreByUser[m.user_id] || 0) * 10) / 10,
        }));

        const sorted = [...members].sort((a, b) => b.score - a.score);
        const currentRank = sorted.findIndex((m) => m.user_id === user.id) + 1;
        const myScore = members.find((m) => m.user_id === user.id)?.score ?? 0;

        return {
          league_id: league.id,
          league_name: formatTeamName(league.name),
          currentRank,
          projectedRank: currentRank,
          myCurrentScore: myScore,
          myProjectedScore: myScore,
          members: sorted,
        };
      });
    }

    setLeagues(leagueStandings);
    setLoading(false);
  }

  function estimateXp(type: string, durationMins: number): number {
    const multiplier = scoringConfig[type] ?? 1.0;
    return Math.round(durationMins * multiplier * 10) / 10;
  }

  function isSessionType(type: string) { return SESSION_TYPES.has(type); }

  function addPlanned() {
    const isSession = isSessionType(selectedType);
    const mins = isSession ? sessions * SESSION_MINUTES : parseFloat(duration);
    if (!mins || mins <= 0) return;
    const xp = estimateXp(selectedType, mins);
    const newActivity: PlannedActivity = {
      id: Date.now().toString(),
      activity_type: selectedType,
      duration_minutes: mins,
      projected_xp: xp,
    };
    const next = [...plannedActivities, newActivity];
    setPlannedActivities(next);
    setDuration('');
    setSessions(1);
    updateLeagueProjections(next);
    // stay open for more
  }

  function closeAddModal() {
    setShowAdd(false);
    setDuration('');
    setSessions(1);
  }

  function removePlanned(id: string) {
    const remaining = plannedActivities.filter((a) => a.id !== id);
    setPlannedActivities(remaining);
    updateLeagueProjections(remaining);
  }

  function updateLeagueProjections(planned: PlannedActivity[]) {
    const bonusXp = planned.reduce((s, a) => s + a.projected_xp, 0);
    setLeagues((prev) => prev.map((league) => {
      const myProjected = league.myCurrentScore + bonusXp;
      const projected = league.members.map((m) =>
        m.user_id === userId ? { ...m, score: myProjected } : m
      ).sort((a, b) => b.score - a.score);
      const projectedRank = projected.findIndex((m) => m.user_id === userId) + 1;
      return { ...league, myProjectedScore: Math.round(myProjected * 10) / 10, projectedRank };
    }));
  }

  const totalPlannedXp = plannedActivities.reduce((s, a) => s + a.projected_xp, 0);
  const projectedTotal = Math.round((currentWeekXp + totalPlannedXp) * 10) / 10;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <RivalTopNav active="today" />
      <ScrollView contentContainerStyle={styles.content}>

        <View style={styles.header}>
          <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/home'))}>
            <Text style={styles.back}>← Back</Text>
          </TouchableOpacity>
        </View>

        <RivalPageHeader title="Plan Your Week" subtitle="See your projected team position." />

        {/* Current vs projected Effort */}
        <View style={styles.xpCard}>
          <View style={styles.xpBlock}>
            <Text style={styles.xpBlockLabel}>Earned so far</Text>
            <Text style={styles.xpBlockValue}>{currentWeekXp}</Text>
            <Text style={styles.xpBlockUnit}>Effort</Text>
          </View>
          <View style={styles.xpDivider} />
          <View style={styles.xpBlock}>
            <Text style={styles.xpBlockLabel}>Planned</Text>
            <Text style={[styles.xpBlockValue, { color: RivalColors.accentText }]}>+{Math.round(totalPlannedXp * 10) / 10}</Text>
            <Text style={styles.xpBlockUnit}>Effort</Text>
          </View>
          <View style={styles.xpDivider} />
          <View style={styles.xpBlock}>
            <Text style={styles.xpBlockLabel}>Projected</Text>
            <Text style={[styles.xpBlockValue, { color: RivalColors.accentFill }]}>{projectedTotal}</Text>
            <Text style={styles.xpBlockUnit}>Effort</Text>
          </View>
        </View>

        {/* Planned activities */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Planned workouts</Text>
          <TouchableOpacity style={styles.addBtn} onPress={() => setShowAdd(true)}>
            <Text style={styles.addBtnText}>+ Add</Text>
          </TouchableOpacity>
        </View>

        {plannedActivities.length === 0 && (
          <View style={styles.emptyPlanned}>
            <Text style={styles.emptyPlannedText}>No workouts planned yet.</Text>
            <Text style={styles.emptyPlannedSub}>Add a workout to see your projected standing.</Text>
          </View>
        )}

        {plannedActivities.map((a) => (
          <View key={a.id} style={styles.plannedRow}>
            <Text style={styles.plannedIcon}>{ACTIVITY_ICONS[a.activity_type] ?? '🏅'}</Text>
            <View style={styles.plannedInfo}>
              <Text style={styles.plannedType}>{a.activity_type}</Text>
              <Text style={styles.plannedMeta}>{a.duration_minutes} min · ×{scoringConfig[a.activity_type] ?? 1.0}</Text>
            </View>
            <Text style={styles.plannedXp}>+{a.projected_xp} Effort</Text>
            <TouchableOpacity onPress={() => removePlanned(a.id)} style={styles.removeBtn}>
              <Text style={styles.removeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>
        ))}

        {/* League impact */}
        {leagues.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { marginTop: 28, marginBottom: 12 }]}>Team impact</Text>
            {leagues.map((league) => {
              const moved = league.projectedRank < league.currentRank;
              const dropped = league.projectedRank > league.currentRank;
              const same = league.projectedRank === league.currentRank;
              return (
                <View key={league.league_id} style={styles.leagueCard}>
                  <View style={styles.leagueCardHeader}>
                    <Text style={styles.leagueName}>{league.league_name}</Text>
                    <View style={styles.rankChangeBlock}>
                      {same && totalPlannedXp === 0 && (
                        <Text style={styles.rankSame}>—</Text>
                      )}
                      {same && totalPlannedXp > 0 && (
                        <Text style={styles.rankSame}>P{league.currentRank} → P{league.projectedRank}</Text>
                      )}
                      {moved && (
                        <Text style={styles.rankUp}>↑ P{league.currentRank} → P{league.projectedRank}</Text>
                      )}
                      {dropped && (
                        <Text style={styles.rankDown}>↓ P{league.currentRank} → P{league.projectedRank}</Text>
                      )}
                    </View>
                  </View>

                  {/* Mini leaderboard preview */}
                  <View style={styles.miniLeaderboard}>
                    {league.members.slice(0, 5).map((member, idx) => {
                      const isMe = member.user_id === userId;
                      const projScore = isMe ? league.myProjectedScore : member.score;
                      return (
                        <View key={member.user_id} style={[styles.miniRow, isMe && styles.miniRowMe]}>
                          <Text style={styles.miniRank}>{idx + 1}.</Text>
                          <Text style={[styles.miniName, isMe && { color: RivalColors.textPrimary, fontWeight: '800' }]}>
                            {isMe ? 'You' : member.name}
                          </Text>
                          <View style={styles.miniScoreBlock}>
                            <Text style={[styles.miniScore, isMe && { color: RivalColors.accentFill }]}>
                              {Math.round(projScore * 10) / 10} Effort
                            </Text>
                            {isMe && totalPlannedXp > 0 && (
                              <Text style={styles.miniBonus}>+{Math.round(totalPlannedXp * 10) / 10}</Text>
                            )}
                          </View>
                        </View>
                      );
                    })}
                    {league.members.length > 5 && (
                      <Text style={styles.moreMembers}>+{league.members.length - 5} more</Text>
                    )}
                  </View>
                </View>
              );
            })}
          </>
        )}

        {!loading && leagues.length === 0 && (
          <View style={styles.noLeagues}>
            <Text style={styles.noLeaguesText}>Join a team to see your projected position here.</Text>
          </View>
        )}

        <Text style={styles.disclaimer}>* Effort estimates based on duration × scoring multiplier. Actual Effort may vary slightly.</Text>

      </ScrollView>

      {/* Add Workout Modal */}
      <Modal visible={showAdd} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalCard} keyboardShouldPersistTaps="handled">
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Plan workouts</Text>
              <TouchableOpacity style={styles.doneBtn} onPress={closeAddModal}>
                <Text style={styles.doneBtnText}>Done</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.modalLabel}>Activity type</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.typeScroll} contentContainerStyle={styles.typeRow}>
              {activityTypes.map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[styles.typeChip, selectedType === t && styles.typeChipActive]}
                  onPress={() => setSelectedType(t)}
                >
                  <Text style={[styles.typeChipText, selectedType === t && styles.typeChipTextActive]}>
                    {ACTIVITY_ICONS[t] ?? '🏅'} {t}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {isSessionType(selectedType) ? (
              <>
                <Text style={styles.modalLabel}>Sessions</Text>
                <View style={styles.stepperRow}>
                  <TouchableOpacity
                    style={styles.stepperBtn}
                    onPress={() => setSessions((s) => Math.max(1, s - 1))}
                  >
                    <Text style={styles.stepperBtnText}>−</Text>
                  </TouchableOpacity>
                  <View style={styles.stepperValueBlock}>
                    <Text style={styles.stepperValue}>{sessions}</Text>
                    <Text style={styles.stepperSub}>{sessions === 1 ? 'session' : 'sessions'} · {sessions * SESSION_MINUTES} min total</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.stepperBtn}
                    onPress={() => setSessions((s) => s + 1)}
                  >
                    <Text style={styles.stepperBtnText}>+</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.previewRow}>
                  <Text style={styles.previewLabel}>Estimated Effort</Text>
                  <Text style={styles.previewXp}>+{estimateXp(selectedType, sessions * SESSION_MINUTES)} Effort</Text>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.modalLabel}>Duration (minutes)</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="e.g. 45"
                  placeholderTextColor={RivalColors.textSecondary}
                  value={duration}
                  onChangeText={setDuration}
                  keyboardType="decimal-pad"
                />
                {duration && parseFloat(duration) > 0 && (
                  <View style={styles.previewRow}>
                    <Text style={styles.previewLabel}>Estimated Effort</Text>
                    <Text style={styles.previewXp}>+{estimateXp(selectedType, parseFloat(duration))} Effort</Text>
                  </View>
                )}
              </>
            )}

            <TouchableOpacity
              style={[styles.addWorkoutBtn, (!isSessionType(selectedType) && (!duration || parseFloat(duration) <= 0)) && styles.saveBtnDisabled]}
              onPress={addPlanned}
              disabled={!isSessionType(selectedType) && (!duration || parseFloat(duration) <= 0)}
            >
              <Text style={styles.addWorkoutBtnText}>+ Add to plan</Text>
            </TouchableOpacity>

            {/* Running list inside modal */}
            {plannedActivities.length > 0 && (
              <>
                <View style={styles.modalDivider} />
                <Text style={styles.modalLabel}>Added so far</Text>
                {plannedActivities.map((a) => (
                  <View key={a.id} style={styles.modalPlannedRow}>
                    <Text style={styles.modalPlannedIcon}>{ACTIVITY_ICONS[a.activity_type] ?? '🏅'}</Text>
                    <View style={styles.modalPlannedInfo}>
                      <Text style={styles.modalPlannedType}>{a.activity_type}</Text>
                      <Text style={styles.modalPlannedMeta}>
                        {isSessionType(a.activity_type)
                          ? `${a.duration_minutes / SESSION_MINUTES} session${a.duration_minutes / SESSION_MINUTES === 1 ? '' : 's'} · ${a.duration_minutes} min`
                          : `${a.duration_minutes} min`}
                      </Text>
                    </View>
                    <Text style={styles.modalPlannedXp}>+{a.projected_xp} Effort</Text>
                    <TouchableOpacity onPress={() => removePlanned(a.id)}>
                      <Text style={styles.removeBtnText}>✕</Text>
                    </TouchableOpacity>
                  </View>
                ))}
                <View style={styles.modalTotalRow}>
                  <Text style={styles.modalTotalLabel}>Total planned</Text>
                  <Text style={styles.modalTotalXp}>+{Math.round(totalPlannedXp * 10) / 10} Effort</Text>
                </View>
              </>
            )}
          </ScrollView>
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
  title: { fontSize: 32, fontWeight: '900', color: RivalColors.textPrimary, marginBottom: 6 },
  subtitle: { fontSize: 14, color: RivalColors.textSecondary, marginBottom: 24, lineHeight: 20 },

  xpCard: {
    backgroundColor: RivalColors.surfaceContainer,
    borderRadius: 16,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 28,
    borderWidth: 1,
    borderColor: RivalColors.surfaceHigh,
  },
  xpBlock: { flex: 1, alignItems: 'center', gap: 2 },
  xpBlockLabel: { fontSize: 11, color: RivalColors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  xpBlockValue: { fontSize: 28, fontWeight: '900', color: RivalColors.textPrimary },
  xpBlockUnit: { fontSize: 11, color: RivalColors.textSecondary, fontWeight: '600' },
  xpDivider: { width: 1, height: 48, backgroundColor: RivalColors.surfaceHigh },

  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: RivalColors.textPrimary },
  addBtn: { backgroundColor: RivalColors.accentFill, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  addBtnText: { color: RivalColors.textPrimary, fontWeight: '700', fontSize: 14 },

  emptyPlanned: { paddingVertical: 28, alignItems: 'center', gap: 6 },
  emptyPlannedText: { fontSize: 14, color: RivalColors.textSecondary },
  emptyPlannedSub: { fontSize: 12, color: '#444444' },

  plannedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: RivalColors.surfaceContainer,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,181,158,0.20)',
  },
  plannedIcon: { fontSize: 22 },
  plannedInfo: { flex: 1, gap: 2 },
  plannedType: { fontSize: 15, fontWeight: '700', color: RivalColors.textPrimary },
  plannedMeta: { fontSize: 12, color: RivalColors.textSecondary },
  plannedXp: { fontSize: 16, fontWeight: '800', color: RivalColors.accentText },
  removeBtn: { padding: 4 },
  removeBtnText: { color: '#444444', fontSize: 16 },

  leagueCard: {
    backgroundColor: RivalColors.surfaceContainer,
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: RivalColors.surfaceHigh,
    gap: 12,
  },
  leagueCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  leagueName: { fontSize: 16, fontWeight: '800', color: RivalColors.textPrimary },
  rankChangeBlock: {},
  rankUp: { fontSize: 14, fontWeight: '800', color: RivalColors.accentGold },
  rankDown: { fontSize: 14, fontWeight: '800', color: '#f87171' },
  rankSame: { fontSize: 13, color: RivalColors.textSecondary },

  miniLeaderboard: { gap: 6 },
  miniRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  miniRowMe: {
    backgroundColor: '#1A0A12',
    borderRadius: 8,
    paddingHorizontal: 10,
    marginHorizontal: -10,
    borderWidth: 1,
    borderColor: 'rgba(217,119,87,0.20)',
  },
  miniRank: { fontSize: 13, color: RivalColors.textSecondary, width: 20 },
  miniName: { flex: 1, fontSize: 13, color: RivalColors.textSecondary },
  miniScoreBlock: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  miniScore: { fontSize: 13, fontWeight: '700', color: RivalColors.textSecondary },
  miniBonus: { fontSize: 11, color: RivalColors.accentText, fontWeight: '700' },
  moreMembers: { fontSize: 12, color: '#444444', textAlign: 'center', paddingTop: 4 },

  noLeagues: { paddingVertical: 24, alignItems: 'center' },
  noLeaguesText: { fontSize: 14, color: RivalColors.textSecondary, textAlign: 'center' },

  disclaimer: { fontSize: 11, color: '#3A3A3A', textAlign: 'center', marginTop: 24, fontStyle: 'italic' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  modalScroll: { maxHeight: '90%' },
  modalCard: { backgroundColor: RivalColors.surfaceContainer, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 28, gap: 14 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { fontSize: 22, fontWeight: '900', color: RivalColors.textPrimary },
  doneBtn: { backgroundColor: RivalColors.accentFill, paddingHorizontal: 18, paddingVertical: 8, borderRadius: 20 },
  doneBtnText: { color: RivalColors.textPrimary, fontWeight: '700', fontSize: 15 },
  modalLabel: { fontSize: 12, fontWeight: '700', color: RivalColors.textSecondary, textTransform: 'uppercase', letterSpacing: 1 },
  typeScroll: { flexGrow: 0 },
  typeRow: { flexDirection: 'row', gap: 8, paddingBottom: 4 },
  typeChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: RivalColors.surfaceHigh, backgroundColor: RivalColors.surfaceContainer },
  typeChipActive: { backgroundColor: RivalColors.accentFill, borderColor: RivalColors.accentFill },
  typeChipText: { fontSize: 13, color: RivalColors.textSecondary, fontWeight: '600' },
  typeChipTextActive: { color: RivalColors.textPrimary },
  modalInput: { backgroundColor: RivalColors.surfaceContainer, borderRadius: 10, padding: 14, color: RivalColors.textPrimary, fontSize: 18, borderWidth: 1, borderColor: RivalColors.surfaceHigh },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(255,181,158,0.07)', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: 'rgba(255,181,158,0.20)' },
  previewLabel: { fontSize: 13, color: RivalColors.textSecondary },
  previewXp: { fontSize: 18, fontWeight: '900', color: RivalColors.accentText },

  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: RivalColors.surfaceContainer, borderRadius: 12, borderWidth: 1, borderColor: RivalColors.surfaceHigh, padding: 8, marginBottom: 12 },
  stepperBtn: { width: 44, height: 44, borderRadius: 10, backgroundColor: RivalColors.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  stepperBtnText: { fontSize: 22, fontWeight: '700', color: RivalColors.textPrimary, lineHeight: 26 },
  stepperValueBlock: { alignItems: 'center', flex: 1 },
  stepperValue: { fontSize: 28, fontWeight: '900', color: RivalColors.textPrimary },
  stepperSub: { fontSize: 12, color: RivalColors.textSecondary, marginTop: 2 },
  addWorkoutBtn: { backgroundColor: RivalColors.accentText, paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  addWorkoutBtnText: { color: RivalColors.surfaceLow, fontSize: 16, fontWeight: '800' },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { color: RivalColors.textPrimary, fontSize: 16, fontWeight: '700' },
  modalDivider: { height: 1, backgroundColor: RivalColors.surfaceHigh, marginVertical: 4 },
  modalPlannedRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  modalPlannedIcon: { fontSize: 18 },
  modalPlannedInfo: { flex: 1 },
  modalPlannedType: { fontSize: 14, fontWeight: '700', color: RivalColors.textPrimary },
  modalPlannedMeta: { fontSize: 12, color: RivalColors.textSecondary },
  modalPlannedXp: { fontSize: 14, fontWeight: '700', color: RivalColors.accentText },
  modalTotalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTopWidth: 1, borderTopColor: RivalColors.surfaceHigh },
  modalTotalLabel: { fontSize: 13, color: RivalColors.textSecondary, fontWeight: '600' },
  modalTotalXp: { fontSize: 16, fontWeight: '900', color: RivalColors.accentText },
});
