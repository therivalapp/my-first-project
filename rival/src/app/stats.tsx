import { useEffect, useState } from 'react';
import { StyleSheet, TouchableOpacity, View, Text, ScrollView, Image, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '../lib/supabase';
import { fetchAllActivities } from '../lib/fetchAllActivities';
import { getLevel, xpProgressInLevel, LEVELS } from '../lib/xp';
import { calculateStreak, StreakResult } from '../lib/streak';
import { getSeasonStartISO, getCurrentSeasonYear, daysUntilSeasonEnd } from '../lib/season';
import { RivalCard, RivalProgressBar, RivalIcon, RivalTopNav } from '../components/rival';
import { RivalColors, RivalRadius, RivalType, RANK_LEVEL_COLORS, RivalSerifFamily } from '../constants/rivalTheme';

// Refined Ember rank ramp only has 4 confirmed anchor colors from the Stitch
// export (see rivalTheme.ts) — the interpolated 10-level ramp is provisional.
function rankColorFor(level: number): string {
  return RANK_LEVEL_COLORS[level - 1] ?? RivalColors.accentText;
}

export default function StatsScreen() {
  const { userId: viewedUserId } = useLocalSearchParams<{ userId?: string }>();
  const [currentAuthUserId, setCurrentAuthUserId] = useState('');
  const isOwnProfile = !viewedUserId || viewedUserId === currentAuthUserId;

  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [totalPoints, setTotalPoints] = useState(0);
  const [seasonPoints, setSeasonPoints] = useState(0);
  const [pastSeasons, setPastSeasons] = useState<Array<{ year: number; final_xp: number; final_rank_name: string }>>([]);
  const [totalActivities, setTotalActivities] = useState(0);
  const [totalTimeMinutes, setTotalTimeMinutes] = useState(0);
  const [hardTimeMinutes, setHardTimeMinutes] = useState(0);
  const [earnedMilestones, setEarnedMilestones] = useState<string[]>([]);
  const [thisWeekPoints, setThisWeekPoints] = useState(0);
  const [totalDistanceKm, setTotalDistanceKm] = useState(0);
  const [totalElevationM, setTotalElevationM] = useState(0);
  const [streak, setStreak] = useState<StreakResult | null>(null);
  const [inspiredCount, setInspiredCount] = useState(0);
  const [inspiredTimes, setInspiredTimes] = useState(0);
  const [memberSince, setMemberSince] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  async function loadStats() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    setCurrentAuthUserId(user.id);

    const targetUserId = viewedUserId || user.id;
    const viewingOther = !!viewedUserId && viewedUserId !== user.id;

    if (!viewingOther && user.created_at) {
      const d = new Date(user.created_at);
      setMemberSince(d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }));
    }

    const [userRes, activitiesRes] = await Promise.all([
      supabase.from('users').select('display_name, avatar_url').eq('id', targetUserId).single(),
      fetchAllActivities(targetUserId, 'id, effort_score, started_at, distance_meters, elevation_meters, duration_seconds, activity_type'),
    ]);

    setDisplayName(userRes.data?.display_name || (!viewingOther ? user.user_metadata?.display_name : '') || 'Athlete');
    setAvatarUrl(userRes.data?.avatar_url || null);

    const activities = activitiesRes;
    const total = activities.reduce((sum, a) => sum + (a.effort_score || 0), 0);
    setTotalPoints(Math.round(total * 10) / 10);

    const seasonStart = new Date(getSeasonStartISO());
    const seasonTotal = activities
      .filter(a => new Date(a.started_at) >= seasonStart)
      .reduce((sum, a) => sum + (a.effort_score || 0), 0);
    setSeasonPoints(Math.round(seasonTotal * 10) / 10);

    setTotalActivities(activities.length);
    setTotalDistanceKm(Math.round(activities.reduce((sum, a) => sum + (a.distance_meters || 0), 0) / 1000));
    setTotalElevationM(Math.round(activities.reduce((sum, a) => sum + (a.elevation_meters || 0), 0)));
    setTotalTimeMinutes(Math.round(activities.reduce((sum, a) => sum + (a.duration_seconds || 0), 0) / 60));
    const HARD_TYPES = new Set(['CrossFit', 'Hyrox', 'HIIT', 'Run', 'Swim', 'Ride', 'WeightTraining', 'Rowing']);
    setHardTimeMinutes(Math.round(activities.filter(a => HARD_TYPES.has(a.activity_type)).reduce((sum, a) => sum + (a.duration_seconds || 0), 0) / 60));

    const { data: milestonesData } = await supabase.from('milestones').select('type').eq('user_id', targetUserId);
    setEarnedMilestones((milestonesData || []).map((m: any) => m.type));

    // Activity ids come from the full fetch above — no second query, and no
    // 1000-row cap undercounting Impact for heavy importers.
    const myActivityIds = activities.map((a: any) => a.id);
    const { data: myRaceIdsData } = await supabase.from('races').select('id').eq('user_id', targetUserId);
    const myRaceIds = (myRaceIdsData || []).map((r: any) => r.id);
    const reactionQueries: PromiseLike<{ data: { user_id: string }[] | null }>[] = [];
    if (myActivityIds.length > 0) reactionQueries.push(supabase.from('feed_reactions').select('user_id').eq('target_type', 'activity').eq('emoji', 'inspired').in('target_id', myActivityIds));
    if (myRaceIds.length > 0) reactionQueries.push(supabase.from('feed_reactions').select('user_id').eq('target_type', 'race').eq('emoji', 'inspired').in('target_id', myRaceIds));
    if (reactionQueries.length > 0) {
      const reactionResults = await Promise.all(reactionQueries);
      const inspirers = new Set<string>();
      let times = 0;
      reactionResults.forEach(r => (r.data || []).forEach(row => {
        if (row.user_id === targetUserId) return;
        inspirers.add(row.user_id);
        times += 1;
      }));
      setInspiredCount(inspirers.size);
      setInspiredTimes(times);
    }

    const now = new Date();
    const day = now.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() + diff);
    weekStart.setHours(0, 0, 0, 0);
    const weekTotal = activities
      .filter((a) => new Date(a.started_at) >= weekStart)
      .reduce((sum, a) => sum + (a.effort_score || 0), 0);
    setThisWeekPoints(Math.round(weekTotal * 10) / 10);

    setStreak(calculateStreak(activities));

    const { data: seasonResultsData } = await supabase
      .from('season_results')
      .select('final_xp, final_rank_name, seasons(year)')
      .eq('user_id', targetUserId)
      .order('seasons(year)', { ascending: false });

    setPastSeasons(
      (seasonResultsData || []).map((r: any) => ({
        year: r.seasons?.year,
        final_xp: r.final_xp,
        final_rank_name: r.final_rank_name,
      }))
    );

    setLoading(false);
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View style={styles.centered}>
          <Text style={styles.loadingText}>Loading…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const lvl = getLevel(seasonPoints);
  const rankColor = rankColorFor(lvl.level);
  const { current, needed, pct } = xpProgressInLevel(seasonPoints);
  const isMax = lvl.maxXp === Infinity;
  const seasonYear = getCurrentSeasonYear();
  const seasonDaysLeft = daysUntilSeasonEnd();

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <RivalTopNav active="today" />
      <ScrollView contentContainerStyle={styles.content}>

        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.back}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{isOwnProfile ? 'Your Stats' : `${displayName}'s Stats`}</Text>
          <View style={{ width: 48 }} />
        </View>

        {/* Rank hero card */}
        <RivalCard style={[styles.rankCard, { borderColor: rankColor + '55', borderWidth: 1 }]}>
          <View style={[styles.rankAvatar, { borderColor: rankColor }]}>
            {avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.rankAvatarImage} />
            ) : (
              <Text style={styles.rankAvatarText}>{displayName ? displayName[0].toUpperCase() : '?'}</Text>
            )}
          </View>
          <Text
            style={[
              styles.rankName,
              { color: '#D8A81D' },
              // Same gradient recipe as the hero number / nav / season wrap
              // rank text — web-only, flat gold above is the native fallback.
              ...(Platform.OS === 'web' ? [{
                backgroundImage: 'linear-gradient(180deg, #FFE48A, #D8A81D)',
                backgroundClip: 'text',
                WebkitBackgroundClip: 'text',
                color: 'transparent',
              } as any] : []),
            ]}
          >
            {lvl.name}
          </Text>
          <View style={[styles.levelPill, { backgroundColor: rankColor + '22', borderColor: rankColor + '55' }]}>
            <Text style={[styles.levelPillText, { color: rankColor }]}>Level {lvl.level} · {Math.round(seasonPoints)} Effort</Text>
          </View>
          <Text style={styles.seasonLabel}>
            {seasonYear} Season{seasonDaysLeft > 0 ? ` · ${seasonDaysLeft}d left` : ''}
          </Text>
          {!isMax && (
            <View style={styles.xpSection}>
              <RivalProgressBar pct={pct} height={8} />
              <Text style={styles.xpToNext}>{needed - current} Effort to {LEVELS[lvl.level]?.name ?? 'max'}</Text>
            </View>
          )}
          {isMax && <Text style={[styles.xpToNext, { color: rankColor, marginTop: 8 }]}>You are Unrivaled.</Text>}
        </RivalCard>

        {/* Stats row 1 */}
        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{thisWeekPoints}</Text>
            <Text style={styles.statLabel}>This week Effort</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{Math.round(totalPoints)}</Text>
            <Text style={styles.statLabel}>Lifetime Effort</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{totalActivities}</Text>
            <Text style={styles.statLabel}>Activities</Text>
          </View>
        </View>

        {/* Time Earned — hero card */}
        {totalTimeMinutes > 0 && (
          <RivalCard style={styles.timeEarnedCard}>
            <Text style={styles.timeEarnedLabel}>Time Earned</Text>
            <Text style={styles.timeEarnedValue}>
              {Math.floor(totalTimeMinutes / 60) > 0 ? `${Math.floor(totalTimeMinutes / 60)}h ` : ''}
              {totalTimeMinutes % 60}m
            </Text>
            <Text style={styles.timeEarnedSub}>Every minute in here is yours. You earned it.</Text>
            {hardTimeMinutes > 0 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
                <RivalIcon name="bolt" size={14} color={RivalColors.accentText} />
                <Text style={[styles.heroHardTime, { marginTop: 0 }]}>
                  {Math.floor(hardTimeMinutes / 60).toLocaleString()}h {hardTimeMinutes % 60}m hard training
                </Text>
              </View>
            )}
          </RivalCard>
        )}

        {/* Stats row 2 */}
        <View style={[styles.statsGrid, { marginBottom: 20 }]}>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, { color: RivalColors.accentText }]}>{totalDistanceKm.toLocaleString()}</Text>
            <Text style={styles.statLabel}>km logged</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, { color: RivalColors.accentText }]}>{totalElevationM.toLocaleString()}</Text>
            <Text style={styles.statLabel}>m climbed</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, { fontSize: 16 }]}>{memberSince || '—'}</Text>
            <Text style={styles.statLabel}>Member since</Text>
          </View>
        </View>

        {/* Streak — a consistency metric, not a scoring bonus */}
        {(() => {
          const currentStreak = streak?.current ?? 0;
          const tiers = [
            { weeks: 2, label: '2 weeks' },
            { weeks: 4, label: '4 weeks' },
            { weeks: 8, label: '8 weeks' },
            { weeks: 12, label: '12 weeks' },
          ];
          return (
            <RivalCard style={styles.streakCard}>
              <View style={styles.streakCardHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <RivalIcon name="fire" size={16} color={RivalColors.textPrimary} />
                  <Text style={styles.streakCardTitle}>Streak</Text>
                </View>
                <View style={styles.streakCurrentPill}>
                  <Text style={styles.streakCurrentText}>
                    {currentStreak > 0 ? `${currentStreak}w streak` : 'No streak'}
                  </Text>
                </View>
              </View>
              <Text style={styles.streakCardSub}>
                Complete at least 3 activities every week to build your streak — a record of your consistency, not a score booster.
              </Text>
              <View style={styles.streakTiers}>
                {tiers.map((tier) => {
                  const isActive = currentStreak >= tier.weeks;
                  const isNext = !isActive && currentStreak < tier.weeks &&
                    (tier === tiers.find(t => currentStreak < t.weeks));
                  return (
                    <View key={tier.weeks} style={[styles.streakTierRow, isActive && styles.streakTierRowActive]}>
                      <Text style={[styles.streakTierWeeks, isActive && { color: RivalColors.accentText }]}>
                        {isActive ? '✓' : isNext ? '→' : '  '} {tier.label}
                      </Text>
                    </View>
                  );
                })}
              </View>
              {currentStreak === 0 && (
                <Text style={styles.streakNudge}>Log 3 activities this week to start your streak.</Text>
              )}
              {currentStreak === 1 && (
                <Text style={styles.streakNudge}>One more qualifying week and it's a real streak.</Text>
              )}
            </RivalCard>
          );
        })()}

        {/* Milestones */}
        {totalTimeMinutes > 0 && (
          <RivalCard style={styles.milestonesCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <RivalIcon name="trophy" size={16} color={RivalColors.textSecondary} />
              <Text style={styles.milestonesTitle}>Milestones</Text>
            </View>
            <View style={styles.milestonesRow}>
              {[
                { type: 'hours_100', icon: 'medal' as const, label: '100h' },
                { type: 'hours_500', icon: 'bolt' as const, label: '500h' },
                { type: 'hours_1000', icon: 'trophy' as const, label: '1,000h' },
                { type: 'hours_5000', icon: 'crown' as const, label: '5,000h' },
              ].map(m => {
                const earned = earnedMilestones.includes(m.type);
                return (
                  <View key={m.type} style={[styles.milestoneBadge, !earned && styles.milestoneBadgeLocked]}>
                    <RivalIcon name={earned ? m.icon : 'lock'} size={24} color={earned ? RivalColors.textPrimary : RivalColors.textSecondary} />
                    <Text style={[styles.milestoneBadgeLabel, !earned && { color: RivalColors.textSecondary }]}>{m.label}</Text>
                  </View>
                );
              })}
            </View>
          </RivalCard>
        )}

        {/* Impact */}
        <RivalCard style={styles.impactCard}>
          <Text style={styles.impactLabel}>IMPACT</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <RivalIcon name="ai" size={18} color={RivalColors.textPrimary} />
            <Text style={styles.impactValue}>
              {inspiredTimes.toLocaleString()} {inspiredTimes === 1 ? 'time' : 'times'} people have shown up for your effort
            </Text>
          </View>
          <Text style={styles.impactSub}>
            {inspiredCount > 0
              ? `by ${inspiredCount.toLocaleString()} ${inspiredCount === 1 ? 'person who keeps' : 'people who keep'} showing up`
              : 'Nobody yet — get out there.'}
          </Text>
        </RivalCard>

        {/* Past Seasons */}
        {pastSeasons.length > 0 && (
          <RivalCard style={styles.pastSeasonsCard}>
            <Text style={styles.pastSeasonsTitle}>Past Seasons</Text>
            {pastSeasons.map((s) => {
              const seasonLvl = getLevel(s.final_xp);
              const seasonRankColor = rankColorFor(seasonLvl.level);
              return (
                <View key={s.year} style={styles.pastSeasonRow}>
                  <Text style={styles.pastSeasonYear}>{s.year}</Text>
                  <Text style={[styles.pastSeasonRank, { color: seasonRankColor }]}>
                    {seasonLvl.icon} {s.final_rank_name}
                  </Text>
                  <Text style={styles.pastSeasonXp}>{Math.round(s.final_xp)} Effort</Text>
                </View>
              );
            })}
          </RivalCard>
        )}

        {/* Quick links */}
        <View style={styles.quickLinks}>
          <TouchableOpacity style={styles.quickLink} onPress={() => router.push('/ranks')}>
            <RivalIcon name="trophy" size={22} color={RivalColors.textPrimary} />
            <Text style={styles.quickLinkText}>All ranks</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickLink} onPress={() => router.push('/achievements')}>
            <RivalIcon name="medal" size={22} color={RivalColors.textPrimary} />
            <Text style={styles.quickLinkText}>Achievements</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickLink} onPress={() => router.push('/recap?type=monthly')}>
            <RivalIcon name="stats" size={22} color={RivalColors.textPrimary} />
            <Text style={styles.quickLinkText}>Monthly Recap</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickLink} onPress={() => router.push('/recap?type=yearly')}>
            <Text style={styles.quickLinkIcon}>🎄</Text>
            <Text style={styles.quickLinkText}>Wrap Up</Text>
          </TouchableOpacity>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: RivalColors.surfaceLow },
  content: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 40 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: RivalColors.textSecondary, fontSize: 16 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 },
  back: { color: RivalColors.accentText, fontSize: 16, width: 48 },
  // Page title in the editorial serif, matching Today / Activity / Team Feed.
  headerTitle: { ...RivalType.titleMd, fontFamily: RivalSerifFamily, fontStyle: 'italic', fontWeight: '600', color: RivalColors.textPrimary },

  rankCard: { marginBottom: 16, alignItems: 'center', gap: 10 },
  rankAvatar: {
    width: 88, height: 88, borderRadius: 44, borderWidth: 3,
    backgroundColor: RivalColors.accentFill, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  rankAvatarImage: { width: 88, height: 88, borderRadius: 44 },
  rankAvatarText: { fontSize: 36, fontWeight: '700', color: RivalColors.onAccentFill },
  rankName: { fontSize: 36, fontWeight: '800', letterSpacing: 1 },
  levelPill: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: RivalRadius.full, borderWidth: 1 },
  levelPillText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  seasonLabel: { fontSize: 12, color: RivalColors.textSecondary, marginTop: -4 },
  xpSection: { width: '100%', gap: 6, marginTop: 4 },
  xpToNext: { fontSize: 12, color: RivalColors.textSecondary, textAlign: 'center' },

  timeEarnedCard: { marginBottom: 16, alignItems: 'center', gap: 6 },
  timeEarnedLabel: { ...RivalType.labelCaps, color: RivalColors.textSecondary },
  timeEarnedValue: { ...RivalType.displayHero, color: RivalColors.accentText },
  timeEarnedSub: { fontSize: 12, color: RivalColors.textSecondary, textAlign: 'center' },
  heroHardTime: { fontSize: 12, color: RivalColors.accentText, fontWeight: '600', marginTop: 2 },

  statsGrid: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  statCard: { flex: 1, backgroundColor: RivalColors.surfaceHigh, borderRadius: RivalRadius.lg, padding: 14, alignItems: 'center', gap: 5 },
  statValue: { fontSize: 20, fontWeight: '700', color: RivalColors.textPrimary },
  statLabel: { ...RivalType.labelCaps, fontSize: 10, color: RivalColors.textSecondary, textAlign: 'center' },

  streakCard: { marginBottom: 16, gap: 14 },
  streakCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  streakCardTitle: { fontSize: 16, fontWeight: '700', color: RivalColors.textPrimary },
  streakCurrentPill: {
    backgroundColor: `${RivalColors.accentFill}22`, borderRadius: RivalRadius.full,
    paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: `${RivalColors.accentFill}55`,
  },
  streakCurrentText: { fontSize: 12, fontWeight: '700', color: RivalColors.accentText },
  streakCardSub: { fontSize: 12, color: RivalColors.textSecondary, lineHeight: 18 },
  streakTiers: { gap: 8 },
  streakTierRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 8, paddingHorizontal: 12, borderRadius: RivalRadius.DEFAULT, backgroundColor: RivalColors.surfaceLow,
  },
  streakTierRowActive: { backgroundColor: RivalColors.surfaceContainer, borderWidth: 1, borderColor: `${RivalColors.accentFill}33` },
  streakTierWeeks: { fontSize: 13, color: RivalColors.textSecondary, fontWeight: '600' },
  streakNudge: { fontSize: 12, color: RivalColors.textSecondary, textAlign: 'center' },

  milestonesCard: { marginBottom: 16, gap: 12 },
  milestonesTitle: { ...RivalType.labelCaps, color: RivalColors.textSecondary },
  milestonesRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  milestoneBadge: { flex: 1, backgroundColor: RivalColors.surfaceContainer, borderRadius: RivalRadius.DEFAULT, paddingVertical: 14, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: `${RivalColors.rankAnchors.unrivaled}55` },
  milestoneBadgeLocked: { backgroundColor: RivalColors.surfaceLowest, borderColor: RivalColors.surfaceContainerHigh },
  milestoneBadgeIcon: { fontSize: 24 },
  milestoneBadgeLabel: { fontSize: 11, fontWeight: '700', color: RivalColors.rankAnchors.unrivaled },

  impactCard: { marginBottom: 16, alignItems: 'center', gap: 6 },
  impactLabel: { ...RivalType.labelCaps, color: RivalColors.tertiary },
  impactValue: { fontSize: 20, fontWeight: '700', color: RivalColors.textPrimary, textAlign: 'center' },
  impactSub: { fontSize: 12, color: RivalColors.textSecondary, textAlign: 'center' },

  pastSeasonsCard: { marginBottom: 16, gap: 10 },
  pastSeasonsTitle: { ...RivalType.labelCaps, color: RivalColors.textSecondary },
  pastSeasonRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8, borderTopWidth: 1, borderTopColor: RivalColors.surfaceContainerHigh },
  pastSeasonYear: { fontSize: 14, fontWeight: '700', color: RivalColors.textPrimary, width: 50 },
  pastSeasonRank: { fontSize: 14, fontWeight: '700', flex: 1 },
  pastSeasonXp: { fontSize: 13, color: RivalColors.textSecondary, fontWeight: '600' },

  quickLinks: { flexDirection: 'row', gap: 10, marginBottom: 16, marginTop: 6 },
  quickLink: { flex: 1, backgroundColor: RivalColors.surfaceHigh, borderRadius: RivalRadius.DEFAULT, paddingVertical: 16, alignItems: 'center', gap: 6 },
  quickLinkIcon: { fontSize: 22 },
  quickLinkText: { color: RivalColors.textSecondary, fontSize: 13, fontWeight: '600' },
});
