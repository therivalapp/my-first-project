import { View, Text, StyleSheet } from 'react-native';
import { RivalSerifFamily } from '../../constants/rivalTheme';

// The page-title block Refined Ember uses at the top of a screen: a centred
// serif-italic title between two hairlines, with a quiet subtitle underneath.
//
// Lifted out of my-activities ("Activity Journal / Every Effort Tells A Story")
// and team-feed ("All Teams Feed / Every Effort, Together"), which had grown
// their own near-identical copies. Every other screen was left with either a
// plain Manrope heading or no title at all, which is what made the app feel
// like two different products depending on which tab you were on.
//
// `rules` can be turned off for screens whose header sits directly on top of a
// card or photo, where the second hairline would double up with an edge.
export function RivalPageHeader({
  title,
  subtitle,
  rules = true,
}: {
  title: string;
  subtitle?: string;
  rules?: boolean;
}) {
  return (
    <View style={[styles.block, rules && styles.blockRuled]}>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    alignSelf: 'center',
    // Cut from the original 16/16/8 (then 8/10/6) — stacked under a lone
    // back-button row (each screen's own `header` wrapper, now marginBottom
    // 0), any top margin here just added straight back to the same dead
    // space Ricky flagged twice. The two rows now sit directly adjacent.
    marginTop: 0,
    marginBottom: 10,
    paddingVertical: 6,
    paddingHorizontal: 20,
  },
  blockRuled: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.12)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  // Same recipe as my-activities' jTitle — the editorial serif, italic, at a
  // deliberately restrained weight and opacity so it reads as a chapter
  // heading rather than shouting over the content below it.
  title: {
    fontFamily: RivalSerifFamily,
    fontStyle: 'italic',
    fontWeight: '500',
    fontSize: 17,
    color: 'rgba(255,255,255,0.75)',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.32)',
    textAlign: 'center',
    marginTop: 2,
  },
});
