import { useEffect, useState } from 'react';
import { RivalColors, RivalSerifFamily } from '../constants/rivalTheme';
import { BREAKPOINT_WIDE_LAYOUT } from '../constants/breakpoints';
import { StyleSheet, View, Text, ScrollView, TouchableOpacity, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { supabase, getAuthUser } from '../lib/supabase';
import { fetchAllActivities } from '../lib/fetchAllActivities';
import { ACHIEVEMENTS, CATEGORY_LABELS, checkAchievements } from '../lib/achievements';
import { calculateStreak } from '../lib/streak';
import { RivalIcon, RivalTopNav, RivalPageHeader, RivalBackButton, RivalMobileHeader, RivalWarm, rm, type RivalIconName } from '../components/rival';

// Real icons on phones instead of the achievement's emoji: one per category.
const CATEGORY_ICON: Record<string, RivalIconName> = {
  firsts: 'star', streak: 'fire', activities: 'checkCircle', distance: 'distance', elevation: 'elevation', rank: 'crown',
};

export default function AchievementsScreen() {
  const { width } = useWindowDimensions();
  const wide = width >= BREAKPOINT_WIDE_LAYOUT;
  const [earnedIds, setEarnedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [newlyEarned, setNewlyEarned] = useState<string[]>([]);

  useEffect(() => { load(); }, []);

  async function load() {
    const { data: { user } } = await getAuthUser();
    if (!user) return;

    // started_at is required by calculateStreak — without it every row is
    // skipped and streak achievements can never unlock.
    const activities = await fetchAllActivities(
      user.id,
      'activity_type, distance_meters, elevation_meters, effort_score, started_at'
    );

    const totalXp = activities.reduce((s, a) => s + (a.effort_score || 0), 0);
    const streak = calculateStreak(activities);
    const calculated = checkAchievements(activities, totalXp, streak.longestEver);

    // Load already-saved achievements
    const { data: saved } = await supabase
      .from('user_achievements')
      .select('achievement_id')
      .eq('user_id', user.id);

    const savedIds = new Set((saved || []).map((r: any) => r.achievement_id));

    // Find newly earned ones not yet saved
    const toSave = calculated.filter((id) => !savedIds.has(id));
    if (toSave.length > 0) {
      // Auto-awarded while viewing; they'll be re-checked next visit, so this
      // logs rather than interrupts.
      const { error: awardErr } = await supabase.from('user_achievements').insert(
        toSave.map((achievement_id) => ({ user_id: user.id, achievement_id }))
      );
      if (awardErr) console.error('Achievement award failed:', awardErr.message);
      setNewlyEarned(toSave);
    }

    setEarnedIds(new Set(calculated));
    setLoading(false);
  }

  const categories = ['firsts', 'streak', 'activities', 'distance', 'elevation', 'rank'];
  const earnedCount = ACHIEVEMENTS.filter((a) => earnedIds.has(a.id)).length;

  if (!wide) {
    const pct = ACHIEVEMENTS.length ? earnedCount / ACHIEVEMENTS.length : 0;
    return (
      <SafeAreaView style={rm.page} edges={['top', 'left', 'right']}>
        <RivalTopNav active="today" />
        <ScrollView contentContainerStyle={[rm.content, ms.content]}>
          <RivalMobileHeader title="Achievements" onBack={() => router.back()} />

          <View style={rm.hero}>
            <Text style={rm.label}>Unlocked</Text>
            <View style={ms.countRow}>
              <Text style={ms.count}>{earnedCount}</Text>
              <Text style={ms.countOf}> / {ACHIEVEMENTS.length}</Text>
            </View>
            <View style={ms.track}><View style={[ms.fill, { width: `${Math.round(pct * 100)}%` }]} /></View>
          </View>

          {newlyEarned.length > 0 && (
            <View style={[rm.card, ms.newCard]}>
              <Text style={[rm.label, { color: RivalColors.accentGold }]}>New unlocks</Text>
              <Text style={ms.newNames}>{newlyEarned.map((id) => ACHIEVEMENTS.find((a) => a.id === id)?.name).join(', ')}</Text>
            </View>
          )}

          {loading && <Text style={[rm.hint, { textAlign: 'center', paddingVertical: 24 }]}>Loading…</Text>}

          {!loading && categories.map((cat) => {
            const items = ACHIEVEMENTS.filter((a) => a.category === cat);
            const got = items.filter((a) => earnedIds.has(a.id)).length;
            return (
              <View key={cat} style={ms.section}>
                <View style={ms.sectionHead}>
                  <Text style={rm.label}>{CATEGORY_LABELS[cat]}</Text>
                  <Text style={ms.sectionCount}>{got} / {items.length}</Text>
                </View>
                <View style={ms.grid}>
                  {items.map((a) => {
                    const earned = earnedIds.has(a.id);
                    const isNew = newlyEarned.includes(a.id);
                    return (
                      <View key={a.id} style={[ms.badge, earned && ms.badgeEarned, isNew && ms.badgeNew]}>
                        <View style={[ms.badgeIcon, earned && ms.badgeIconEarned, isNew && ms.badgeIconNew]}>
                          <RivalIcon
                            name={earned ? (CATEGORY_ICON[cat] ?? 'medal') : 'lock'}
                            size={18}
                            color={isNew ? RivalColors.accentGold : earned ? RivalColors.accentText : RivalWarm.muted}
                          />
                        </View>
                        <Text style={[ms.badgeName, !earned && ms.dim]} numberOfLines={2}>{a.name}</Text>
                        <Text style={[ms.badgeDesc, !earned && ms.dim]} numberOfLines={2}>{a.desc}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            );
          })}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <RivalTopNav active="today" />
      <ScrollView contentContainerStyle={styles.content}>

        <View style={styles.header}>
          <RivalBackButton onPress={() => router.back()} color={RivalColors.accentFill} />
        </View>

        <RivalPageHeader title="Achievements" subtitle={`${earnedCount} of ${ACHIEVEMENTS.length} unlocked`} />

        {newlyEarned.length > 0 && (
          <View style={styles.newBanner}>
            <Text style={styles.newBannerTitle}>New unlocks</Text>
            <Text style={styles.newBannerSub}>
              {newlyEarned.map((id) => ACHIEVEMENTS.find((a) => a.id === id)?.name).join(', ')}
            </Text>
          </View>
        )}

        {loading && <Text style={styles.emptyText}>Loading…</Text>}

        {!loading && categories.map((cat) => {
          const items = ACHIEVEMENTS.filter((a) => a.category === cat);
          return (
            <View key={cat} style={styles.section}>
              <Text style={styles.sectionTitle}>{CATEGORY_LABELS[cat]}</Text>
              <View style={styles.grid}>
                {items.map((achievement) => {
                  const earned = earnedIds.has(achievement.id);
                  const isNew = newlyEarned.includes(achievement.id);
                  return (
                    <View
                      key={achievement.id}
                      style={[
                        styles.badge,
                        earned ? styles.badgeEarned : styles.badgeLocked,
                        isNew && styles.badgeNew,
                      ]}
                    >
                      <Text style={[styles.badgeIcon, !earned && styles.badgeIconLocked]}>
                        {earned ? achievement.icon : '🔒'}
                      </Text>
                      <Text style={[styles.badgeName, !earned && styles.badgeNameLocked]}>
                        {achievement.name}
                      </Text>
                      <Text style={[styles.badgeDesc, !earned && styles.badgeDescLocked]}>
                        {achievement.desc}
                      </Text>
                      {isNew && <View style={styles.newDot} />}
                    </View>
                  );
                })}
              </View>
            </View>
          );
        })}

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: RivalColors.surfaceLow },
  content: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 48 },
  header: { marginBottom: 0 },
  back: { color: RivalColors.accentFill, fontSize: 16 },
  title: { fontSize: 32, fontWeight: '900', color: RivalColors.textPrimary, marginBottom: 4 },
  subtitle: { fontSize: 14, color: RivalColors.textSecondary, marginBottom: 24 },
  newBanner: {
    backgroundColor: '#fbbf2420',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#fbbf2440',
    padding: 14,
    marginBottom: 24,
    gap: 4,
  },
  newBannerTitle: { fontSize: 15, fontWeight: '800', color: RivalColors.accentGold },
  newBannerSub: { fontSize: 13, color: '#fcd34d' },
  emptyText: { color: RivalColors.textSecondary, textAlign: 'center', paddingVertical: 24 },
  section: { marginBottom: 32 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: RivalColors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  badge: {
    width: '30%',
    flexGrow: 1,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    position: 'relative',
  },
  badgeEarned: {
    backgroundColor: RivalColors.surfaceLow,
    borderColor: RivalColors.accentFill,
  },
  badgeLocked: {
    backgroundColor: '#1E1E1E',
    borderColor: RivalColors.surfaceHigh,
  },
  badgeNew: {
    borderColor: RivalColors.accentGold,
    backgroundColor: '#fbbf2411',
  },
  badgeIcon: { fontSize: 28 },
  badgeIconLocked: { opacity: 0.3 },
  badgeName: {
    fontSize: 12,
    fontWeight: '800',
    color: RivalColors.textPrimary,
    textAlign: 'center',
  },
  badgeNameLocked: { color: '#444444' },
  badgeDesc: {
    fontSize: 10,
    color: RivalColors.textSecondary,
    textAlign: 'center',
    lineHeight: 14,
  },
  badgeDescLocked: { color: '#444444' },
  newDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: RivalColors.accentGold,
  },
});

// Mobile only — the RIVAL look (see RivalMobile.tsx).
const ms = StyleSheet.create({
  content: { paddingBottom: 120 },
  countRow: { flexDirection: 'row', alignItems: 'baseline' },
  count: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 44, fontWeight: '700', color: '#fff', lineHeight: 50 },
  countOf: { fontSize: 16, fontWeight: '700', color: RivalWarm.muted },
  track: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: RivalColors.accentText },
  newCard: { borderColor: 'rgba(245,183,89,0.35)', gap: 4 },
  newNames: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 16, color: '#fff' },
  section: { gap: 10, marginTop: 6 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionCount: { fontSize: 12, fontWeight: '700', color: RivalWarm.muted },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  badge: {
    width: '30%', flexGrow: 1, alignItems: 'center', gap: 6, padding: 12, borderRadius: 16,
    backgroundColor: RivalWarm.card, borderWidth: 1, borderColor: RivalWarm.cardBorder,
  },
  badgeEarned: { borderColor: 'rgba(255,181,158,0.28)' },
  badgeNew: { borderColor: 'rgba(245,183,89,0.6)', backgroundColor: 'rgba(245,183,89,0.06)' },
  badgeIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.04)' },
  badgeIconEarned: { backgroundColor: 'rgba(255,209,190,0.10)' },
  badgeIconNew: { backgroundColor: 'rgba(245,183,89,0.14)' },
  badgeName: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 13.5, fontWeight: '700', color: '#fff', textAlign: 'center' },
  badgeDesc: { fontSize: 10.5, lineHeight: 14, color: RivalWarm.soft, textAlign: 'center' },
  dim: { opacity: 0.4 },
});
