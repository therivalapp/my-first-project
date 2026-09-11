import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

const getStorage = () => {
  if (Platform.OS !== 'web') return AsyncStorage;
  if (typeof window === 'undefined') return undefined;
  return {
    getItem: (key: string) => Promise.resolve(localStorage.getItem(key)),
    setItem: (key: string, value: string) => Promise.resolve(localStorage.setItem(key, value)),
    removeItem: (key: string) => Promise.resolve(localStorage.removeItem(key)),
  };
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: getStorage(),
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// The signed-in user, read from the session already stored on the device.
//
// supabase.auth.getUser() makes a network round trip to the auth server to
// re-validate the token, and nearly every screen called it FIRST, before any
// of its own queries could start — so every page paid one extra full round
// trip before loading anything. The session is already here: the database
// still checks the token on every query (RLS), so the client only needs the
// id to know whose data to ask for. getSession() also refreshes an expired
// token itself, so this stays correct across long sessions.
//
// Same { data: { user } } shape as getUser(), so call sites swap one-for-one.
export async function getAuthUser() {
  const { data: { session } } = await supabase.auth.getSession();
  return { data: { user: session?.user ?? null } };
}
