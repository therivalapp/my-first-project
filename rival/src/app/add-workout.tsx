import { StyleSheet, TouchableOpacity, View, Text, ScrollView, ImageBackground, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { RivalButton, RivalCard, RivalIcon, RivalIconName, RivalTopNav, RivalBackButton} from '../components/rival';
import { RivalColors, RivalRadius, RivalType } from '../constants/rivalTheme';
import { BREAKPOINT_WIDE_LAYOUT } from '../constants/breakpoints';

const PROCESS_STEPS: Array<{ icon: RivalIconName; title: string; body: string }> = [
  { icon: 'addPhoto', title: '1. Add a photo', body: 'Snap your training app screen, gym whiteboard, or workout card — in good light.' },
  { icon: 'brain', title: '2. AI reads it', body: 'Our vision model pulls out exercises, sets, weights and distance for you.' },
  { icon: 'verified', title: '3. Review & save', body: 'Check the details, make any tweaks, and your Effort updates instantly.' },
];

export default function AddWorkoutScreen() {
  const { width } = useWindowDimensions();
  const wide = width >= BREAKPOINT_WIDE_LAYOUT;

  const card = (
    icon: RivalIconName,
    accent: boolean,
    title: string,
    body: string,
    actions: React.ReactNode,
  ) => (
    <RivalCard glass style={[styles.card, wide && styles.cardWide]}>
      <View style={[styles.cardIcon, accent && styles.cardIconAccent]}>
        <RivalIcon name={icon} size={26} color={accent ? RivalColors.accentText : RivalColors.textSecondary} />
      </View>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardBody}>{body}</Text>
      <View style={styles.cardActions}>{actions}</View>
    </RivalCard>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ImageBackground
        source={require('../../assets/images/backgrounds/optimized/overhead-squat-warehouse-gym.jpg')}
        style={styles.bg}
        imageStyle={styles.bgImage}
        resizeMode="cover"
      >
        <RivalTopNav />
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <RivalBackButton onPress={() => router.back()} color={RivalColors.accentFill} />
          </View>

          {/* Hero */}
          <View style={styles.hero}>
            <Text style={styles.heroLabel}>ADD WORKOUT</Text>
            <Text style={styles.heroTitle}>Honor the commitment.</Text>
            <Text style={styles.heroSub}>
              However you trained, get it counted — snap your workout card, type it in
              by hand, or log a whole week in one go.
            </Text>
          </View>

          {/* Three actions */}
          <View style={[styles.cardsRow, wide && styles.cardsRowWide]}>
            {card('scan', true, 'Scan Workout', 'Photo or upload your workout card for automatic AI analysis.', (
              <>
                <RivalButton label="Capture" onPress={() => router.push('/scan-workout?source=camera')} style={styles.fullBtn} />
                <RivalButton label="Upload Card" onPress={() => router.push('/scan-workout?source=gallery')} variant="secondary" style={styles.fullBtn} />
              </>
            ))}
            {card('manual', false, 'Manual Entry', 'Prefer the traditional way? Type your session in point by point.', (
              <RivalButton label="Start Manual  →" onPress={() => router.push('/manual-entry')} variant="secondary" style={styles.fullBtn} />
            ))}
            {card('batch', false, 'Batch Log', 'Log multiple days at once — ideal for catching up on a full week.', (
              <RivalButton label="Start Batch  →" onPress={() => router.push('/weekly-scan')} variant="secondary" style={styles.fullBtn} />
            ))}
          </View>

          {/* How it works */}
          <View style={styles.processSection}>
            <Text style={styles.processTitle}>HOW IT WORKS</Text>
            <View style={[styles.processRow, wide && styles.processRowWide]}>
              {PROCESS_STEPS.map((step) => (
                <View key={step.title} style={[styles.processStep, wide && styles.processStepWide]}>
                  <View style={styles.processIcon}>
                    <RivalIcon name={step.icon} size={20} color={RivalColors.accentText} />
                  </View>
                  <View style={styles.processTextWrap}>
                    <Text style={styles.processStepTitle}>{step.title}</Text>
                    <Text style={styles.processStepBody}>{step.body}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      </ImageBackground>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: RivalColors.surfaceLow },
  bg: { flex: 1 },
  // Faint atmospheric backdrop, like the mockup's opacity-10 image behind a scrim.
  bgImage: { opacity: 0.12 },
  content: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 48, maxWidth: 1200, width: '100%', alignSelf: 'center' },

  header: { marginBottom: 8 },
  back: { color: RivalColors.accentText, fontSize: 16 },

  hero: { alignItems: 'center', gap: 12, marginTop: 24, marginBottom: 40, paddingHorizontal: 8 },
  heroLabel: { ...RivalType.labelCaps, color: RivalColors.accentText, letterSpacing: 2 },
  heroTitle: { ...RivalType.headlineLg, color: RivalColors.textPrimary, textAlign: 'center' },
  heroSub: { ...RivalType.bodyMd, color: RivalColors.textSecondary, textAlign: 'center', maxWidth: 560 },

  cardsRow: { gap: 16, marginBottom: 48 },
  cardsRowWide: { flexDirection: 'row', alignItems: 'stretch' },
  card: { flex: 1, padding: 24, gap: 12 },
  cardWide: { flexBasis: 0 },
  cardIcon: { width: 56, height: 56, borderRadius: RivalRadius.md, backgroundColor: RivalColors.surfaceContainerHigh, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  cardIconAccent: { backgroundColor: `${RivalColors.accentFill}22` },
  cardIconText: { fontSize: 26 },
  cardTitle: { ...RivalType.titleMd, fontSize: 22, color: RivalColors.textPrimary },
  cardBody: { ...RivalType.bodyMd, fontSize: 14, color: RivalColors.textSecondary },
  cardActions: { marginTop: 'auto', paddingTop: 16, gap: 10 },
  fullBtn: { width: '100%' },

  processSection: { borderTopWidth: 1, borderTopColor: RivalColors.outlineVariant, paddingTop: 32 },
  processTitle: { ...RivalType.labelCaps, color: RivalColors.textSecondary, textAlign: 'center', letterSpacing: 3, marginBottom: 28 },
  processRow: { gap: 24 },
  processRowWide: { flexDirection: 'row' },
  processStep: { flexDirection: 'row', gap: 16, alignItems: 'flex-start' },
  processStepWide: { flex: 1 },
  processIcon: { width: 48, height: 48, borderRadius: RivalRadius.full, backgroundColor: RivalColors.surfaceContainerHigh, borderWidth: 1, borderColor: RivalColors.outlineVariant, alignItems: 'center', justifyContent: 'center' },
  processIconText: { fontSize: 20 },
  processTextWrap: { flex: 1, gap: 4 },
  processStepTitle: { ...RivalType.titleMd, fontSize: 16, color: RivalColors.textPrimary },
  processStepBody: { fontSize: 13, color: RivalColors.textSecondary, lineHeight: 19 },
});
