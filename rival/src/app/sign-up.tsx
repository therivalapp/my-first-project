import { useState } from 'react';
import { StyleSheet, TouchableOpacity, View, Text, TextInput, Image, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { supabase } from '../lib/supabase';
import { displayToIsoDate, maskDateInput } from '../lib/dateFormat';
import { RivalButton, RivalIcon, RivalBackButton } from '../components/rival';
import { RivalColors, RivalRadius, RivalType } from '../constants/rivalTheme';

const SMOKE_SOURCE = require('../../assets/images/backgrounds/optimized/podium-smoke.jpg');

export default function SignUpScreen() {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dob, setDob] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSignUp() {
    if (!firstName.trim() || !lastName.trim() || !dob.trim() || !email || !password) {
      setError('Please fill in all fields');
      return;
    }

    const dobIso = displayToIsoDate(dob.trim());
    if (!dobIso) {
      setError('Enter your date of birth as DD/MM/YYYY');
      return;
    }

    setLoading(true);
    setError('');

    const displayName = `${firstName.trim()} ${lastName.trim()}`;

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName }
      }
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    // The handle_new_user trigger only inserts id/email/display_name from
    // auth metadata — date of birth isn't part of that, so it's a separate
    // write against the row the trigger just created.
    if (data.user) {
      await supabase.from('users').update({ date_of_birth: dobIso }).eq('id', data.user.id);
    }

    router.replace('/home');
  }

  return (
    <View style={styles.bg}>
      <Image source={SMOKE_SOURCE} style={styles.smoke} resizeMode="cover" />
      <Image source={SMOKE_SOURCE} style={styles.smokeTop} resizeMode="cover" />
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>

          <RivalBackButton onPress={() => router.back()} style={styles.back} />

          <Text style={styles.logo}>RIVAL</Text>

          <View style={styles.card}>
            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <View style={styles.nameRow}>
              <View style={[styles.inputGroup, styles.nameField]}>
                <Text style={styles.label}>First Name</Text>
                <TextInput
                  style={styles.input}
                  placeholder="First name"
                  placeholderTextColor={RivalColors.textSecondary}
                  value={firstName}
                  onChangeText={setFirstName}
                  autoCapitalize="words"
                />
              </View>
              <View style={[styles.inputGroup, styles.nameField]}>
                <Text style={styles.label}>Last Name</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Last name"
                  placeholderTextColor={RivalColors.textSecondary}
                  value={lastName}
                  onChangeText={setLastName}
                  autoCapitalize="words"
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Date of Birth</Text>
              <TextInput
                style={styles.input}
                placeholder="DD/MM/YYYY"
                placeholderTextColor={RivalColors.textSecondary}
                value={dob}
                onChangeText={(v) => setDob(maskDateInput(v))}
                keyboardType="number-pad"
                maxLength={10}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                placeholder="your@email.com"
                placeholderTextColor={RivalColors.textSecondary}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                keyboardType="email-address"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Password</Text>
              <View style={styles.passwordRow}>
                <TextInput
                  style={styles.passwordInput}
                  placeholder="Min 6 characters"
                  placeholderTextColor={RivalColors.textSecondary}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeButton}>
                  <RivalIcon name={showPassword ? 'eyeOff' : 'eye'} size={20} color={RivalColors.textSecondary} />
                </TouchableOpacity>
              </View>
            </View>

            <RivalButton
              label={loading ? 'Creating account...' : 'Create Account'}
              onPress={handleSignUp}
              disabled={loading}
              style={styles.submitBtn}
            />

            <TouchableOpacity onPress={() => router.push('/sign-in')}>
              <Text style={styles.link}>Already have an account? Sign in</Text>
            </TouchableOpacity>
          </View>

        </View>
      </SafeAreaView>
    </View>
  );
}

// Deliberately mirrors sign-in.tsx. The two screens sit either side of one
// decision, and sign-up had never been brought onto Refined Ember — it was
// still flat #111111 with the pre-Ember magenta and lime, so creating an
// account looked like a different product from signing in to one.
const styles = StyleSheet.create({
  bg: {
    flex: 1,
    position: 'relative',
    backgroundColor: RivalColors.surfaceLowest,
  },
  // Same warm-smoke texture as the Today screen's Weekly Leader/Legacy
  // sections — low opacity, faded on both edges so it reads as ambient
  // atmosphere behind the logo/card rather than a cropped photo.
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
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
    justifyContent: 'center',
  },
  back: {
    position: 'absolute',
    top: 16,
    left: 24,
  },
  backText: {
    color: RivalColors.textPrimary,
    fontSize: 16,
  },
  logo: {
    ...RivalType.titleMd,
    color: RivalColors.textPrimary,
    letterSpacing: 6,
    textAlign: 'center',
    marginBottom: 24,
  },
  card: {
    backgroundColor: RivalColors.surfaceHigh,
    borderRadius: RivalRadius.lg,
    padding: 24,
    gap: 16,
  },
  title: {
    ...RivalType.headlineLgMobile,
    color: RivalColors.textPrimary,
    textTransform: 'uppercase',
  },
  subtitle: {
    ...RivalType.bodyMd,
    color: RivalColors.textSecondary,
    marginTop: -8,
  },
  errorBox: {
    backgroundColor: RivalColors.errorContainer,
    borderRadius: RivalRadius.DEFAULT,
    padding: 12,
  },
  errorText: {
    color: RivalColors.error,
    fontSize: 14,
  },
  inputGroup: {
    gap: 8,
  },
  nameRow: {
    flexDirection: 'row',
    gap: 12,
  },
  nameField: {
    flex: 1,
  },
  label: {
    ...RivalType.labelCaps,
    fontSize: 12,
    color: RivalColors.onSurfaceVariant,
  },
  input: {
    backgroundColor: RivalColors.surfaceBright,
    borderRadius: RivalRadius.DEFAULT,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: RivalColors.textPrimary,
    fontSize: 16,
  },
  passwordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: RivalColors.surfaceBright,
    borderRadius: RivalRadius.DEFAULT,
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: RivalColors.textPrimary,
    fontSize: 16,
  },
  eyeButton: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  submitBtn: {
    marginTop: 8,
  },
  link: {
    color: RivalColors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
  },
});
