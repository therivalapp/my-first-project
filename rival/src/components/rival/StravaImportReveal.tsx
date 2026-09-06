import { useEffect, useRef, useState } from 'react';
import { Animated, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { RivalColors, RivalFontFamily, RivalRadius, RivalSerifFamily, RivalType } from '../../constants/rivalTheme';

// Count-up duration per number. Deliberately unhurried — this is the payoff
// moment for connecting Strava, and at the original pace the numbers landed
// before they registered.
const COUNT_MS = 2400;
// How long "Converting to Effort" holds before the second number starts. Long
// enough to read and to let the pulse breathe at least once.
const CONVERT_MS = 1600;

type Phase = 'time' | 'converting' | 'effort' | 'done';

// The payoff after a Strava import: the training time just brought in, then —
// as a deliberate second beat — what that converts to in Effort. Staged
// rather than shown at once, because the conversion IS the thing being
// taught here; a new user's first exposure to what Effort even is.
//
// Shared because there are two ways in and both deserve it: connecting Strava
// for the first time (strava-callback) and re-running the import from Settings.
export function StravaImportReveal({
  seconds,
  effort,
  activities,
  onDone,
  ctaLabel = 'Continue',
}: {
  seconds: number;
  effort: number;
  activities?: number;
  onDone?: () => void;
  ctaLabel?: string;
}) {
  const hoursTarget = seconds / 3600;
  const [phase, setPhase] = useState<Phase>('time');
  const [countHours, setCountHours] = useState(0);
  const [countEffort, setCountEffort] = useState(0);

  // ease-out — moves immediately, then settles onto the final number, rather
  // than a linear ramp that reads as mechanical.
  function runCount(target: number, onFrame: (v: number) => void, onEnd: () => void) {
    const start = Date.now();
    let raf: number;
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / COUNT_MS);
      onFrame(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) raf = requestAnimationFrame(tick);
      else onEnd();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }

  useEffect(() => {
    if (phase === 'time') return runCount(hoursTarget, setCountHours, () => setPhase('converting'));
    if (phase === 'effort') return runCount(effort, setCountEffort, () => setPhase('done'));
    if (phase === 'converting') {
      const id = setTimeout(() => setPhase('effort'), CONVERT_MS);
      return () => clearTimeout(id);
    }
  }, [phase, hoursTarget, effort]);

  // Same gentle breathe the import button uses while it's working — signals
  // "in progress" without the alarm a hard flash would carry.
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (phase !== 'converting') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.35, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [phase, pulse]);

  // The CTA breathes too, to draw the eye once the sequence settles. Kept
  // shallower and slower than the "converting" pulse above — this one sits
  // on screen indefinitely, and a deep fade on a button you're meant to tap
  // starts reading as disabled rather than inviting.
  const ctaPulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (phase !== 'done') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(ctaPulse, { toValue: 0.6, duration: 900, useNativeDriver: true }),
        Animated.timing(ctaPulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [phase, ctaPulse]);

  const wholeHours = Math.floor(countHours);
  const wholeMinutes = Math.round((countHours - wholeHours) * 60);
  const showEffort = phase === 'effort' || phase === 'done';

  return (
    <View style={styles.wrap}>
      <Text style={styles.kicker}>Total Time Earned</Text>
      <Text style={styles.timeValue}>
        {wholeHours.toLocaleString()}
        <Text style={styles.timeUnit}>h</Text> {wholeMinutes}
        <Text style={styles.timeUnit}>m</Text>
      </Text>

      {/* Fixed-height slots. Without them, each stage appearing re-centred the
          whole block and the time number visibly jumped up the screen mid-
          sequence — the one number the user is reading at that moment. */}
      <View style={styles.midSlot}>
        {phase === 'converting' ? (
          <Animated.Text style={[styles.converting, { opacity: pulse }]}>Converting to Effort…</Animated.Text>
        ) : null}
        {showEffort ? (
          <>
            <View style={styles.rule} />
            <Text style={styles.kicker}>Effort</Text>
            <Text style={styles.effortValue}>{Math.round(countEffort).toLocaleString()}</Text>
          </>
        ) : null}
      </View>

      <View style={styles.footerSlot}>
        {phase === 'done' ? (
          <>
            <Text style={styles.sub}>
              {activities != null ? `${activities.toLocaleString()} activities. ` : ''}
              Every one of them already counted.
            </Text>
            {onDone ? (
              <Animated.View style={{ opacity: ctaPulse }}>
                <TouchableOpacity style={styles.cta} onPress={onDone}>
                  <Text style={styles.ctaText}>{ctaLabel}</Text>
                </TouchableOpacity>
              </Animated.View>
            ) : null}
          </>
        ) : null}
      </View>
    </View>
  );
}

// Same warm gradient the Today screen puts on Total Time Earned, so the number
// a user meets here is recognisably the same number they'll see on Today.
const goldGradient = Platform.OS === 'web'
  ? ({
      backgroundImage: 'linear-gradient(100deg, #D97757 0%, #ffb59e 45%, #F5B759 100%)',
      backgroundClip: 'text',
      WebkitBackgroundClip: 'text',
      color: 'transparent',
    } as any)
  : {};

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingHorizontal: 24 },
  // Sized to the tallest state each slot ever holds, so the total height is
  // constant across every phase and nothing above shifts as stages appear.
  midSlot: { height: 126, alignItems: 'center', justifyContent: 'center' },
  footerSlot: { height: 150, alignItems: 'center', justifyContent: 'flex-start' },
  kicker: {
    ...RivalType.labelCaps,
    fontSize: 10,
    letterSpacing: 1.6,
    color: RivalColors.textSecondary,
  },
  timeValue: {
    fontFamily: RivalSerifFamily,
    fontStyle: 'italic',
    fontWeight: '700',
    fontSize: 52,
    lineHeight: 58,
    letterSpacing: 0.2,
    color: RivalColors.accentFill,
    marginTop: 6,
    ...goldGradient,
  },
  timeUnit: {
    fontFamily: RivalFontFamily,
    fontSize: 24,
    fontWeight: '700',
    color: RivalColors.accentFill,
    marginHorizontal: 1,
  },
  // Same size as the time above it, not smaller. Effort is the currency the
  // app actually competes on — time is the input, this is the result — so
  // shrinking it read as a footnote to the "real" number rather than the
  // point of the conversion.
  effortValue: {
    fontFamily: RivalSerifFamily,
    fontStyle: 'italic',
    fontWeight: '700',
    fontSize: 52,
    lineHeight: 58,
    letterSpacing: 0.2,
    color: RivalColors.accentFill,
    marginTop: 4,
    ...goldGradient,
  },
  converting: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.4,
    color: RivalColors.accentText,
  },
  rule: {
    width: 56,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.14)',
    marginBottom: 14,
  },
  sub: {
    fontSize: 13,
    lineHeight: 19,
    color: RivalColors.textSecondary,
    textAlign: 'center',
    marginTop: 24,
  },
  cta: {
    marginTop: 22,
    borderWidth: 1.5,
    borderColor: RivalColors.accentFill,
    borderRadius: RivalRadius.full,
    paddingHorizontal: 32,
    paddingVertical: 13,
  },
  ctaText: { color: RivalColors.accentText, fontSize: 15, fontWeight: '700', letterSpacing: 0.5 },
});
