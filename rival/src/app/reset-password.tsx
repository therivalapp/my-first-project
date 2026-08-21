import { useEffect, useState } from 'react';
import { StyleSheet, TouchableOpacity, View, Text, TextInput, Platform, Image as RNImage } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Asset } from 'expo-asset';
import { RivalButton } from '../components/rival';
import { RivalColors, RivalRadius, RivalType } from '../constants/rivalTheme';
import { router } from 'expo-router';
import { supabase } from '../lib/supabase';

export default function ResetPasswordScreen() {
  const [status, setStatus] = useState<'verifying' | 'ready' | 'invalid'>('verifying');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      setStatus('invalid');
      return;
    }

    (async () => {
      // Supabase's recovery link appends tokens to the URL fragment (since we run with
      // detectSessionInUrl: false to avoid clashing with the Strava OAuth callback).
      const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
      const hashParams = new URLSearchParams(hash);
      const accessToken = hashParams.get('access_token');
      const refreshToken = hashParams.get('refresh_token');

      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        setStatus(error ? 'invalid' : 'ready');
        return;
      }

      // Fallback: PKCE-style `?code=` param.
      const queryParams = new URLSearchParams(window.location.search);
      const code = queryParams.get('code');
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        setStatus(error ? 'invalid' : 'ready');
        return;
      }

      setStatus('invalid');
    })();
  }, []);

  async function handleSetNewPassword() {
    if (!newPassword || newPassword.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }
    setSaving(true);
    setError('');
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.replace('/home');
  }

  // Same photographic shell as sign-in and sign-up — this is the third screen
  // in that flow and was the last one still on the flat pre-Ember background.
  const bgUri = Platform.OS === 'web'
    ? Asset.fromModule(require('../../assets/images/backgrounds/optimized/ridge-runners-hazy-backlit.jpg')).uri
    : undefined;

  return (
    <View style={styles.bg}>
      {Platform.OS === 'web' ? (
        // @ts-ignore — intentional escape hatch to a real DOM element; RN Web's renderer is react-dom
        <img
          src={bgUri}
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: '50% center', display: 'block' }}
        />
      ) : (
        <RNImage
          source={require('../../assets/images/backgrounds/optimized/ridge-runners-hazy-backlit.jpg')}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
        />
      )}
      <View style={styles.scrim} />
      <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.logo}>RIVAL</Text>

        {status === 'verifying' && (
          <Text style={styles.status}>Verifying your reset link…</Text>
        )}

        {status === 'invalid' && (
          <>
            <Text style={styles.status}>
              This reset link is invalid or has expired. Go back and request a new one.
            </Text>
            <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace('/sign-in'))}>
              <Text style={styles.link}>← Back to sign in</Text>
            </TouchableOpacity>
          </>
        )}

        {status === 'ready' && (
          <View style={styles.card}>
            <Text style={styles.title}>Set a new password</Text>

            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <View style={styles.inputGroup}>
              <Text style={styles.label}>New Password</Text>
              <TextInput
                style={styles.input}
                placeholder="At least 6 characters"
                placeholderTextColor={RivalColors.textSecondary}
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Confirm Password</Text>
              <TextInput
                style={styles.input}
                placeholder="Re-enter password"
                placeholderTextColor={RivalColors.textSecondary}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
              />
            </View>

            <RivalButton
              label={saving ? 'Saving…' : 'Set New Password'}
              onPress={handleSetNewPassword}
              disabled={saving}
              style={styles.submitBtn}
            />
          </View>
        )}
      </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, position: 'relative', backgroundColor: RivalColors.surfaceLowest },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(14,14,14,0.35)' },
  container: { flex: 1 },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 24, paddingHorizontal: 24 },
  logo: { fontSize: 32, fontWeight: '900', color: RivalColors.textPrimary, letterSpacing: 6 },
  status: { fontSize: 16, color: RivalColors.textSecondary, textAlign: 'center', paddingHorizontal: 20 },
  link: { color: RivalColors.accentFill, fontSize: 15, fontWeight: '600' },
  card: {
    backgroundColor: 'rgba(19,19,19,0.75)',
    borderRadius: RivalRadius.lg,
    padding: 24,
    gap: 16,
  },
  submitBtn: { marginTop: 8 },
  title: { fontSize: 24, fontWeight: '800', color: RivalColors.textPrimary, textAlign: 'center' },
  errorBox: { backgroundColor: RivalColors.errorContainer, borderRadius: 8, padding: 12, borderWidth: 1, borderColor: RivalColors.error },
  errorText: { color: RivalColors.error, fontSize: 14 },
  inputGroup: { gap: 8 },
  label: { color: RivalColors.textPrimary, fontSize: 14, fontWeight: '600' },
  input: {
    backgroundColor: RivalColors.surfaceLow, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14,
    color: RivalColors.textPrimary, fontSize: 16, borderWidth: 1, borderColor: RivalColors.accentText,
  },
  primaryButton: { backgroundColor: RivalColors.accentFill, paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  disabled: { opacity: 0.6 },
  primaryButtonText: { color: RivalColors.textPrimary, fontSize: 18, fontWeight: '700' },
});
