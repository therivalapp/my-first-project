import { useEffect, useState } from 'react';
import { RivalColors, RivalSerifFamily } from '../constants/rivalTheme';
import { BREAKPOINT_WIDE_LAYOUT } from '../constants/breakpoints';
import { getSeasonStartISO, getCurrentSeasonYear } from '../lib/season';
import { StyleSheet, View, Text, ScrollView, TouchableOpacity, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { supabase, getAuthUser } from '../lib/supabase';
import { LEVELS, getLevel } from '../lib/xp';
import { RivalIcon, RivalTopNav, RivalPageHeader, RivalBackButton, RivalMobileHeader, RivalWarm, rm } from '../components/rival';

export default function RanksScreen() {
  const { width } = useWindowDimensions();
  const wide = width >= BREAKPOINT_WIDE_LAYOUT;
  const [totalXp, setTotalXp] = useState(0);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await getAuthUser();
      if (!user) return;
      const { data } = await supabase
        .from('activities')
        .select('effort_score')
        .eq('user_id', user.id)
        // Rank is a season measure everywhere else (top bar, Home, Stats);
        // lifetime Effort here showed a rank the rest of the app didn't.
        .gte('started_at', getSeasonStartISO());
      const xp = data?.reduce((sum, a) => sum + (a.effort_score || 0), 0) ?? 0;
      setTotalXp(xp);
    }
    load();
  }, []);

  const currentLevel = getLevel(totalXp);

  if (!wide) {
    const next = LEVELS.find((l) => l.level === currentLevel.level + 1);
    const span = next ? next.minXp - currentLevel.minXp : 1;
    const pct = next ? Math.min(1, (totalXp - currentLevel.minXp) / span) : 1;
    return (
      <SafeAreaView style={rm.page} edges={['top', 'left', 'right']}>
        <RivalTopNav active="today" />
        <ScrollView contentContainerStyle={[rm.content, ms.content]}>
          <RivalMobileHeader title="Ranks" onBack={() => router.back()} />

          <View style={[rm.hero, { alignItems: 'center' }]}>
            <Text style={rm.label}>{getCurrentSeasonYear()} rank</Text>
            <Text style={[ms.heroRank, { color: currentLevel.color }]}>{currentLevel.name}</Text>
            <Text style={rm.hint}>Level {currentLevel.level} · {Math.round(totalXp).toLocaleString()} Effort</Text>
            {next ? (
              <View style={ms.progress}>
                <View style={ms.track}><View style={[ms.fill, { width: `${Math.round(pct * 100)}%`, backgroundColor: currentLevel.color }]} /></View>
                <Text style={[rm.hint, { textAlign: 'center' }]}>{Math.max(0, Math.ceil(next.minXp - totalXp)).toLocaleString()} Effort to {next.name}</Text>
              </View>
            ) : (
              <Text style={[rm.hint, { color: currentLevel.color }]}>The top rank.</Text>
            )}
          </View>

          <Text style={ms.explainer}>
            Rank is earned each year. Everyone starts again on 1 January. Lifetime totals never reset.
          </Text>

          <View style={{ gap: 8 }}>
            {LEVELS.map((lvl) => {
              const isCurrent = lvl.level === currentLevel.level;
              const isUnlocked = totalXp >= lvl.minXp;
              const isLast = lvl.maxXp === Infinity;
              return (
                <View key={lvl.level} style={[rm.card, ms.row, isCurrent && { borderColor: lvl.color + '99', backgroundColor: lvl.color + '14' }]}>
                  <View style={[ms.num, { borderColor: isUnlocked ? lvl.color : 'rgba(255,255,255,0.12)' }]}>
                    <Text style={[ms.numText, { color: isUnlocked ? lvl.color : RivalWarm.muted }]}>{lvl.level}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[ms.name, { color: isUnlocked ? lvl.color : 'rgba(255,255,255,0.35)' }]}>{lvl.name}</Text>
                    <Text style={rm.hint}>{lvl.minXp.toLocaleString()}{isLast ? '+' : ` – ${lvl.maxXp.toLocaleString()}`} Effort</Text>
                  </View>
                  {isCurrent ? (
                    <View style={[ms.you, { backgroundColor: lvl.color }]}><Text style={ms.youText}>YOU</Text></View>
                  ) : isUnlocked ? (
                    <RivalIcon name="checkCircle" size={20} color={lvl.color} />
                  ) : (
                    <RivalIcon name="lock" size={18} color={RivalWarm.muted} />
                  )}
                </View>
              );
            })}
          </View>

          <Text style={ms.footer}>Everyone has a Rival. Only a few become Unrivaled.</Text>
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

        <RivalPageHeader title="Ranks" subtitle="Start as a Rookie. Become Unrivaled." />

        <View style={styles.list}>
          {LEVELS.map((lvl, i) => {
            const isCurrent = lvl.level === currentLevel.level;
            const isUnlocked = totalXp >= lvl.minXp;
            const isLast = lvl.maxXp === Infinity;

            return (
              <View key={lvl.level}>
                <View style={[
                  styles.row,
                  isCurrent && { borderColor: lvl.color, borderWidth: 2, backgroundColor: lvl.color + '11' },
                  !isCurrent && { borderColor: isUnlocked ? lvl.color + '44' : RivalColors.surfaceHigh },
                ]}>
                  {/* Left: icon + colour strip */}
                  <View style={[styles.strip, { backgroundColor: lvl.color }]}>
                    <Text style={styles.stripIcon}>{lvl.icon}</Text>
                    <Text style={styles.stripNum}>{lvl.level}</Text>
                  </View>

                  {/* Middle: name + xp */}
                  <View style={styles.rowContent}>
                    <Text style={[styles.rankName, { color: isUnlocked ? lvl.color : '#3A3A3A' }]}>
                      {lvl.name}
                    </Text>
                    <Text style={styles.xpReq}>
                      {lvl.minXp.toLocaleString()} Effort{!isLast ? ` – ${lvl.maxXp.toLocaleString()}` : '+'}
                    </Text>
                  </View>

                  {/* Right: status */}
                  <View style={styles.rowRight}>
                    {isCurrent && (
                      <View style={[styles.currentBadge, { backgroundColor: lvl.color }]}>
                        <Text style={styles.currentBadgeText}>YOU</Text>
                      </View>
                    )}
                    {!isCurrent && isUnlocked && (
                      <Text style={[styles.check, { color: lvl.color }]}>✓</Text>
                    )}
                    {!isUnlocked && (
                      <Text style={styles.locked}>🔒</Text>
                    )}
                  </View>
                </View>

                {/* Connector line between rows */}
                {i < LEVELS.length - 1 && (
                  <View style={styles.connector}>
                    <View style={[styles.connectorLine, { backgroundColor: isUnlocked && totalXp >= LEVELS[i + 1].minXp ? lvl.color : RivalColors.surfaceHigh }]} />
                  </View>
                )}
              </View>
            );
          })}
        </View>

        <Text style={styles.footer}>Everyone has a Rival. Only a few become Unrivaled.</Text>

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
  subtitle: { fontSize: 14, color: RivalColors.textSecondary, marginBottom: 32 },
  list: { gap: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
    backgroundColor: RivalColors.surfaceLow,
  },
  strip: {
    width: 56,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    gap: 2,
  },
  stripIcon: {
    fontSize: 22,
  },
  stripNum: {
    fontSize: 11,
    fontWeight: '900',
    color: RivalColors.textPrimary,
    opacity: 0.8,
  },
  rowContent: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 4,
  },
  rankName: {
    fontSize: 20,
    fontWeight: '900',
  },
  xpReq: {
    fontSize: 12,
    color: RivalColors.textSecondary,
    fontWeight: '600',
  },
  rowRight: {
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  currentBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  currentBadgeText: {
    fontSize: 11,
    fontWeight: '900',
    color: RivalColors.textPrimary,
    letterSpacing: 1,
  },
  check: {
    fontSize: 20,
    fontWeight: '900',
  },
  locked: {
    fontSize: 16,
    opacity: 0.4,
  },
  connector: {
    alignItems: 'center',
    height: 12,
  },
  connectorLine: {
    width: 2,
    height: '100%',
  },
  footer: {
    fontSize: 13,
    color: RivalColors.accentText,
    textAlign: 'center',
    marginTop: 32,
    fontStyle: 'italic',
  },
});

// Mobile only — the RIVAL look (see RivalMobile.tsx).
const ms = StyleSheet.create({
  explainer: { fontSize: 13, lineHeight: 19, color: 'rgba(255,255,255,0.6)', textAlign: 'center', paddingHorizontal: 16 },
  content: { paddingBottom: 120 },
  heroRank: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 40, fontWeight: '700', lineHeight: 46 },
  progress: { alignSelf: 'stretch', gap: 8, marginTop: 4 },
  track: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12 },
  num: { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  numText: { fontSize: 14, fontWeight: '800' },
  name: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 19, fontWeight: '700' },
  you: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  youText: { fontSize: 10.5, fontWeight: '900', letterSpacing: 1, color: '#fff' },
  footer: { fontFamily: RivalSerifFamily, fontStyle: 'italic', fontSize: 15, color: RivalColors.accentText, textAlign: 'center', marginTop: 8 },
});
