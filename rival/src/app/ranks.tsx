import { useEffect, useState } from 'react';
import { RivalColors } from '../constants/rivalTheme';
import { StyleSheet, View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { supabase } from '../lib/supabase';
import { LEVELS, getLevel } from '../lib/xp';
import { RivalIcon, RivalTopNav, RivalPageHeader, RivalBackButton} from '../components/rival';

export default function RanksScreen() {
  const [totalXp, setTotalXp] = useState(0);

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('activities')
        .select('effort_score')
        .eq('user_id', user.id);
      const xp = data?.reduce((sum, a) => sum + (a.effort_score || 0), 0) ?? 0;
      setTotalXp(xp);
    }
    load();
  }, []);

  const currentLevel = getLevel(totalXp);

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
