import { useEffect } from 'react';
import { StyleSheet, TouchableOpacity, View, Text, Image, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { supabase } from '../lib/supabase';
import { RivalButton } from '../components/rival';
import { RivalColors, RivalType } from '../constants/rivalTheme';

const SMOKE_SOURCE = require('../../assets/images/backgrounds/optimized/podium-smoke.jpg');

export default function WelcomeScreen() {
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        router.replace('/home');
      }
    });
  }, []);

  return (
    <View style={styles.page}>
      <View style={styles.hero}>
        <Image source={SMOKE_SOURCE} style={styles.smoke} resizeMode="cover" />
        <Image source={SMOKE_SOURCE} style={styles.smokeTop} resizeMode="cover" />
        <SafeAreaView style={styles.content}>
          <Text style={styles.logo}>RIVAL</Text>

          <View style={styles.taglineWrap}>
            <Text style={styles.tagline}>Fitness is better shared</Text>
          </View>

          <View style={styles.buttons}>
            <RivalButton
              label="Let's Go"
              onPress={() => router.push('/sign-up')}
              labelStyle={{ textTransform: 'uppercase', letterSpacing: 2, fontWeight: '800' }}
              style={{ paddingHorizontal: 19, paddingVertical: 11 }}
            />
            <TouchableOpacity onPress={() => router.push('/sign-in')} style={styles.signInLink}>
              <Text style={styles.signInLinkText}>Sign In</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Plain block container — no flex:1 (that requires a height-bounded ancestor,
  // which this screen deliberately no longer has).
  page: {
    backgroundColor: RivalColors.surfaceLow,
  },
  // minHeight, not height: fills at least one screen but is free to grow, same as
  // any ordinary hero section on a real webpage.
  // 100dvh, not 100vh: on iOS 100vh is the LARGE viewport (741px of an 852px
  // iPhone 15 Pro screen) while only the SMALL viewport (659px) is actually
  // visible behind Safari's toolbar. Sizing the hero to 100vh pushed the
  // "Sign In" link into that hidden 82px band with nothing scrollable to
  // reach it. 100dvh tracks what is genuinely visible.
  hero: {
    position: 'relative',
    minHeight: '100dvh' as any,
    width: '100%',
  },
  // Same warm-smoke texture as the Today screen's Weekly Leader/Legacy
  // sections — low opacity, faded on both edges so it reads as ambient
  // atmosphere behind the logo rather than a cropped photo.
  smoke: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    width: '100%', height: 500,
    opacity: 0.3,
    ...(Platform.OS === 'web'
      ? ({
          maskImage: 'linear-gradient(to bottom, transparent 0%, black 30%, black 60%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 30%, black 60%, transparent 100%)',
        } as any)
      : {}),
  },
  // Second copy, mirrored vertically and pinned to the top instead — smoke
  // rising from both edges toward the middle rather than just the bottom.
  smokeTop: {
    position: 'absolute',
    top: 0, left: 0, right: 0,
    width: '100%', height: 500,
    opacity: 0.3,
    transform: [{ scaleY: -1 }],
    ...(Platform.OS === 'web'
      ? ({
          maskImage: 'linear-gradient(to bottom, transparent 0%, black 30%, black 60%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 30%, black 60%, transparent 100%)',
        } as any)
      : {}),
  },
  content: {
    minHeight: '100dvh' as any,
    paddingHorizontal: 24,
    justifyContent: 'space-between',
    paddingBottom: 40,
    paddingTop: 24,
  },
  logo: {
    ...RivalType.titleMd,
    color: RivalColors.textPrimary,
    letterSpacing: 8,
    textAlign: 'center',
  },
  taglineWrap: {
    alignItems: 'center',
    gap: 16,
    paddingBottom: 32,
    marginTop: 80,
  },
  tagline: {
    ...RivalType.headlineLg,
    color: RivalColors.textPrimary,
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 4,
    fontSize: 17,
    lineHeight: 22,
  },
  buttons: {
    gap: 4,
    alignItems: 'center',
  },
  signInLink: {
    paddingVertical: 14,
  },
  signInLinkText: {
    color: RivalColors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
});
