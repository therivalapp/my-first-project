// The Manrope webfont lives here. It used to be imported only by
// constants/theme.ts, a starter-template module whose consumers were deleted --
// which silently dropped the stylesheet from the build entirely and fell every
// heading back to the browser's default serif. Imported at the app root now, so
// it cannot be orphaned by removing a screen again.
import '../global.css';
import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAppFonts } from '../lib/useAppFonts';
import { registerForPushNotifications } from '../lib/notifications';

export default function RootLayout() {
  // Native registers Manrope from bundled .ttf files; web is a no-op because
  // global.css already loads the family from Google Fonts. See useAppFonts.ts —
  // the platform split keeps ~570KB of duplicate .ttf out of the web bundle.
  // Rendering is deliberately not gated on this: a brief native fallback-font
  // flash beats a blank splash.
  useAppFonts();

  useEffect(() => {
    registerForPushNotifications();
  }, []);

  // iOS standalone (home-screen) web apps report two different heights, and
  // which one is bigger is the opposite of what this clamp originally
  // assumed. Measured on device 2026-08-24 (standalone:Y, iPhone 15 Pro):
  //
  //   window.innerHeight / visualViewport.height / documentElement.clientHeight = 793
  //   100vh / window.screen.height                                              = 852
  //
  // The LAYOUT viewport (793) is 59px SHORTER than the real screen (852), so
  // clamping the app to visualViewport.height ended the shell — and every
  // background painted inside it — 59px above the true bottom edge, leaving a
  // strip of bare page canvas (#0e0e0e) below it that read as dead space
  // under the bottom nav. Size to 100vh (the real screen) instead. Keep
  // measuring visualViewport, but only to SHRINK for the software keyboard —
  // never to cap the resting height below the screen.
  const [viewportHeight, setViewportHeight] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.visualViewport) return;
    const vv = window.visualViewport;
    const update = () => {
      // Only clamp when the visual viewport is genuinely smaller than the
      // layout viewport — i.e. the keyboard is up. Otherwise let 100vh win.
      setViewportHeight(vv.height < window.innerHeight ? vv.height : undefined);
    };
    update();
    vv.addEventListener('resize', update);
    return () => vv.removeEventListener('resize', update);
  }, []);

  // SafeAreaProvider is what supplies the real device insets (notch, status bar, home
  // indicator) to every SafeAreaView in the app. Without it they silently report zero,
  // which is why content couldn't be inset independently of the full-bleed backgrounds.
  // On web it reads the CSS env(safe-area-inset-*) values, which only resolve because
  // the viewport meta in +html.tsx sets viewport-fit=cover.
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {/* position:fixed, not a plain in-flow block. Expo's reset gives <body>
          height:100% — which resolves against the SHORT layout viewport (793
          on device) — together with overflow:hidden, so an in-flow shell was
          clipped at 793 no matter what height it asked for, cutting the last
          card off above the true screen bottom. A fixed element is not
          clipped by an ancestor's overflow, which is exactly why the portaled
          nav pill and the fixed backgrounds already reached 852 while scroll
          content could not. Anchoring the shell the same way lets it own the
          full screen independently of body's height.

          100vh, not 100dvh: on iOS standalone dvh resolves to that same short
          793 viewport; 100vh is the one that reaches the true 852. */}
      <View
        style={Platform.OS === 'web'
          ? { position: 'fixed', top: 0, left: 0, right: 0, height: viewportHeight ?? '100vh', overflow: 'hidden' } as any
          : { flex: 1 }}
      >
        <Stack screenOptions={{ headerShown: false }} />
      </View>
    </SafeAreaProvider>
  );
}
