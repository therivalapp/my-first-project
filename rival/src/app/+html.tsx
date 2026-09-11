import { ScrollViewStyleReset } from 'expo-router/html';

// Custom root HTML shell for the web export. Adds "Add to Home Screen" support —
// without these tags, iOS Safari always keeps its URL/back-forward bar visible;
// with them, launching from a home-screen icon opens fully chrome-less, like a
// native app.
export default function Root({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        {/* maximum-scale=1 stops iOS Safari AUTO-ZOOMING when you focus an
            input whose font-size is under 16px — it zooms in, and never fully
            zooms back out, which shifts the whole layout. 28 inputs across the
            app are under 16px (many deliberately, down to 10px in Team Hub),
            so bumping them all would mean redesigning those screens.
            User-initiated pinch-zoom is unaffected: iOS has ignored
            maximum-scale for pinch since iOS 10 and only honours it for this
            automatic focus zoom. */}
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, shrink-to-fit=no, viewport-fit=cover" />

        {/* iOS home-screen install: standalone (chrome-less) launch */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="RIVAL" />
        <link rel="apple-touch-icon" href="/assets/images/icon.png" />

        {/* Android/Chrome install prompt + standalone display */}
        <meta name="theme-color" content="#0e0e0e" />
        <link rel="manifest" href="/manifest.json" />

        {/* Open the connection to Supabase while the app's JavaScript is still
            downloading, so the first data request doesn't also have to wait
            for DNS, TCP and TLS setup. Rendered at build time, when the
            EXPO_PUBLIC_ variables are available. */}
        {!!process.env.EXPO_PUBLIC_SUPABASE_URL && (
          <>
            <link rel="preconnect" href={process.env.EXPO_PUBLIC_SUPABASE_URL} crossOrigin="" />
            <link rel="dns-prefetch" href={process.env.EXPO_PUBLIC_SUPABASE_URL} />
          </>
        )}

        <ScrollViewStyleReset />

        {/* Every OTHER screen in this app is a react-native-web "app shell": locked to
            one viewport, RN's own ScrollViews handle scrolling internally. That's
            correct for them. An earlier attempt fixed iOS letterboxing by forcing the
            WHOLE document scrollable here — reverted, since the actual fix only
            applies to one screen (see index.tsx, which is a plain flowing document,
            not part of the app shell, for exactly this reason). Keep this to things
            safe for every route: a dark default backdrop so nothing white flashes
            through — never a height/overflow override. */}
        <style dangerouslySetInnerHTML={{ __html: `
          html, body, #root { background-color: #0e0e0e; }
          /* Expo's reset gives html/body/#root height:100%, which resolves
             against the LAYOUT viewport. On iOS standalone that is 59px
             shorter than the real screen (measured on device 2026-08-24:
             layout 793 vs screen/100vh 852), and body also carries
             overflow:hidden — so the bottom 59px of any in-flow content was
             clipped away, cutting the last card off mid-shape. The nav pill
             and the fixed backgrounds escaped it only because position:fixed
             ignores ancestor overflow, which is why they reached the true
             bottom while scroll content did not.

             100vh is the true screen height, so this un-clips that strip.
             It is a height correction, NOT the document-scroll override the
             comment above warns against: overflow is untouched, so the app
             shell still scrolls internally and index.tsx still flows. */
          html, body, #root { height: 100vh; }
        ` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
