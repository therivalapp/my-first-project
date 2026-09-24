import { useEffect, useState } from 'react';
import { Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { supabase, getAuthUser } from '@/lib/supabase';
import { RivalColors, RivalRadius, RivalSerifFamily, RivalType } from '@/constants/rivalTheme';
import { RivalIcon } from '@/components/rival';

// Asks the owner — and only the owner — whether a very short synced activity
// was real. Nothing in the data can answer this: Sandy's 74-second "run" was
// her watch losing GPS mid-session, which looks identical to a genuine sprint.
// The person who was there knows instantly; the app never will.
//
// Shown as a prompt rather than a line on the feed card because the people who
// need to act on it are exactly the people who won't go looking. Only appears
// when there is something unanswered, at most once per activity, and "Keep it"
// is a real answer that is remembered.

const SHORT_UNDER_SECONDS = 3 * 60;
const LOOKBACK_DAYS = 7;

type ShortActivity = {
  id: string;
  name: string | null;
  activity_type: string;
  started_at: string;
  duration_seconds: number;
  distance_meters: number | null;
};

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  });
}

function formatLength(a: ShortActivity): string {
  const mins = Math.max(1, Math.round(a.duration_seconds / 60));
  const time = a.duration_seconds < 60 ? `${a.duration_seconds} sec` : `${mins} min`;
  if (a.distance_meters && a.distance_meters > 50) {
    return `${(a.distance_meters / 1000).toFixed(1)} km · ${time}`;
  }
  return time;
}

export function ShortActivityReview() {
  const [queue, setQueue] = useState<ShortActivity[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: { user } } = await getAuthUser();
      if (!user) return;
      const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from('activities')
        .select('id, name, activity_type, started_at, duration_seconds, distance_meters')
        .eq('user_id', user.id)
        .is('short_review_dismissed_at', null)
        .gt('duration_seconds', 0)
        .lt('duration_seconds', SHORT_UNDER_SECONDS)
        .gte('started_at', since)
        .order('started_at', { ascending: false });
      if (!cancelled && data?.length) setQueue(data as ShortActivity[]);
    })();
    return () => { cancelled = true; };
  }, []);

  function drop(id: string) {
    setQueue((prev) => prev.filter((a) => a.id !== id));
  }

  // "Keep it" has to be recorded, or the same question returns on every app
  // open and a helpful prompt turns into nagging.
  async function keep(a: ShortActivity) {
    setBusyId(a.id);
    const { error } = await supabase
      .from('activities')
      .update({ short_review_dismissed_at: new Date().toISOString() })
      .eq('id', a.id);
    setBusyId(null);
    // An RLS failure updates nothing and raises nothing, so a silent no-op
    // would quietly bring this back tomorrow. Say so instead of pretending.
    if (error) {
      if (Platform.OS === 'web') window.alert(`Couldn't save that: ${error.message}`);
      return;
    }
    drop(a.id);
  }

  async function remove(a: ShortActivity) {
    setBusyId(a.id);
    const { error } = await supabase.from('activities').delete().eq('id', a.id);
    setBusyId(null);
    if (error) {
      if (Platform.OS === 'web') window.alert(`Couldn't remove that: ${error.message}`);
      return;
    }
    drop(a.id);
  }

  if (!queue.length) return null;
  const current = queue[0];
  const busy = busyId === current.id;

  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => drop(current.id)}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <RivalIcon name="timerOutline" size={26} color={RivalColors.accentText} />
          <Text style={styles.title}>That was a short one</Text>
          <Text style={styles.body}>
            This synced from your watch. Keep it if it was real — remove it if the recording
            started by accident.
          </Text>

          <View style={styles.detail}>
            <Text style={styles.detailName}>{current.name || current.activity_type}</Text>
            <Text style={styles.detailMeta}>{formatLength(current)}</Text>
            <Text style={styles.detailWhen}>{formatWhen(current.started_at)}</Text>
          </View>

          <View style={styles.actions}>
            <TouchableOpacity style={styles.remove} onPress={() => remove(current)} disabled={busy} activeOpacity={0.8}>
              <Text style={styles.removeText}>{busy ? '…' : 'Remove it'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.keep} onPress={() => keep(current)} disabled={busy} activeOpacity={0.8}>
              <Text style={styles.keepText}>{busy ? '…' : 'Keep it'}</Text>
            </TouchableOpacity>
          </View>

          {queue.length > 1 ? (
            <Text style={styles.remaining}>{queue.length - 1} more to check</Text>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: {
    width: '100%', maxWidth: 380, alignItems: 'center', gap: 10,
    backgroundColor: RivalColors.surfaceHigh, borderRadius: RivalRadius.lg,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', padding: 22,
  },
  title: { ...RivalType.titleMd, fontFamily: RivalSerifFamily, color: '#fff', textAlign: 'center' },
  body: { fontSize: 13.5, lineHeight: 19, color: RivalColors.textSecondary, textAlign: 'center' },
  detail: {
    width: '100%', alignItems: 'center', gap: 2, marginTop: 6, paddingVertical: 12,
    borderTopWidth: 1, borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.07)',
  },
  detailName: { fontSize: 15, fontWeight: '700', color: '#fff' },
  detailMeta: { fontSize: 13, color: RivalColors.accentText },
  detailWhen: { fontSize: 12, color: RivalColors.textSecondary },
  actions: { flexDirection: 'row', gap: 10, width: '100%', marginTop: 8 },
  // Keep is the safer answer, so it carries the accent; removing is
  // deliberately the plainer of the two rather than the loud red one.
  remove: {
    flex: 1, paddingVertical: 12, borderRadius: RivalRadius.md, alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)',
  },
  removeText: { fontSize: 14, fontWeight: '600', color: RivalColors.textSecondary },
  keep: { flex: 1, paddingVertical: 12, borderRadius: RivalRadius.md, alignItems: 'center', backgroundColor: RivalColors.accentFill },
  keepText: { fontSize: 14, fontWeight: '700', color: '#2a1410' },
  remaining: { fontSize: 11.5, color: RivalColors.textSecondary, marginTop: 2 },
});
