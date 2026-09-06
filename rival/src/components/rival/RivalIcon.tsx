// Imported from the per-family subpaths, NOT the '@expo/vector-icons' barrel.
// The barrel registers every family's .ttf as a static asset at module scope,
// so importing two families from it shipped all of them -- FontAwesome (4/5/6),
// Ionicons, Fontisto, AntDesign, MaterialSymbols and more, none of which this
// app uses. That was ~3MB of fonts downloaded on first load for nothing.
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { StyleProp, TextStyle } from 'react-native';
import { RivalColors } from '../../constants/rivalTheme';

// Single source of truth for icons — semantic name → Material glyph. Material
// Symbols is what the Stitch mockups use, so MaterialIcons is a near-exact
// match, monochrome, and takes the accent color. Add new icons HERE, once,
// rather than reaching for an emoji in a screen (see feedback: real icons > emoji).
// Most entries are a plain MaterialIcons glyph name; a `['mci', name]` tuple
// pulls from MaterialCommunityIcons instead, for the rare case where that
// set has a better-proportioned glyph (e.g. notificationsActive, where
// MaterialIcons' bell has its ring-lines crowded right against the bell body).
const ICONS = {
  // Navigation / interface
  // The thin iOS-style chevron (not a full-shaft arrow, which read as a
  // generic "go back" link rather than the app-chrome back button Ricky
  // pointed at). Specifically the -new variant: plain 'arrow-back-ios'
  // draws its chevron in the LEFT half of its advance width (ink centre
  // sits 4.6px off at size 18), so it can never look centred inside
  // RivalBackButton's circle without a hand-tuned offset that would then
  // be wrong at every other icon size. 'arrow-back-ios-new' is the same
  // shape drawn centred (measured: 0.09px off), so no nudge is needed.
  back: 'arrow-back-ios-new',
  forward: 'arrow-forward',
  // Calendar month/year nav — chevron family (not arrow-back/forward above,
  // which are line-arrows and don't visually match the double-chevron).
  monthBack: 'keyboard-arrow-left',
  monthForward: 'keyboard-arrow-right',
  yearBack: 'keyboard-double-arrow-left',
  yearForward: 'keyboard-double-arrow-right',
  chevronRight: 'chevron-right',
  chevronDown: 'keyboard-arrow-down',
  edit: 'edit',
  more: 'more-vert',
  close: 'close',
  eye: 'visibility',
  eyeOff: 'visibility-off',
  add: 'add',
  check: 'check',
  refresh: 'refresh',
  checkCircle: 'check-circle',
  checkCircleOutline: 'check-circle-outline',
  // Bare heartbeat waveform, no monitor-screen frame around it — MaterialIcons'
  // only pulse-shaped glyph (monitor-heart) bakes in that rounded-rect frame.
  pulse: ['mci', 'pulse'] as const,
  target: 'adjust',
  search: 'search',
  camera: 'photo-camera',
  upload: 'file-upload',
  notifications: 'notifications',
  notificationsActive: ['mci', 'bell-ring-outline'] as const,
  // Plain outline bell (mockup's ti-bell) — distinct from `notifications`
  // above, which is the filled glyph other screens already depend on.
  notificationsOutline: 'notifications-none',
  settings: 'settings',
  logout: 'logout',
  delete: 'delete-outline',
  link: 'link',
  openInNew: 'open-in-new',
  apps: 'apps',
  person: 'person',
  groups: 'groups',
  home: 'home',
  flag: 'flag',
  key: 'vpn-key',
  globe: 'public',
  // Ricky's pick from a side-by-side icon comparison, 2026-08-24
  // — MaterialCommunityIcons' open-outline speech bubble, not MaterialIcons'
  // filled one this used to be.
  chat: ['mci', 'chat-outline'] as const,
  pin: 'push-pin',
  star: 'star',
  starOutline: 'star-border',

  // Add Workout / logging
  scan: 'document-scanner',
  manual: 'edit-note',
  batch: 'calendar-view-week',
  addPhoto: 'add-a-photo',
  brain: 'psychology',
  verified: 'verified',
  ai: 'auto-awesome',
  calendar: 'calendar-today',
  calendarMonth: 'calendar-view-month',

  // Stats / metrics
  trophy: 'emoji-events',
  fire: 'local-fire-department',
  medal: 'military-tech',
  // Literal crown shape (no other call site depends on this glyph today —
  // verified via a repo-wide grep before changing it).
  crown: ['mci', 'crown-outline'] as const,
  lock: 'lock',               // locked milestone/achievement
  bolt: 'bolt',
  rest: 'bedtime',            // idle / no recent activity
  trendUp: 'trending-up',
  trendDown: 'trending-down',
  location: 'place',
  elevation: 'terrain',
  // Route/path glyph (no other call site depends on this today — verified
  // via a repo-wide grep) — was 'straighten' (a ruler), which reads as
  // measuring-tool rather than distance-traveled.
  distance: 'route',
  timer: 'timer',
  // MaterialIcons' plain "timer" renders with a solid-filled button/hand —
  // this outline variant for spots that need a lighter, unfilled stopwatch.
  timerOutline: ['mci', 'timer-outline'] as const,
  schedule: 'schedule',
  stats: 'bar-chart',
  race: 'sports-score',
  impact: 'auto-awesome',
  doubleChevronUp: 'keyboard-double-arrow-up',

  // Activity types
  run: 'directions-run',
  ride: 'directions-bike',
  swim: 'pool',
  rowing: 'rowing',
  weights: 'fitness-center',
  // MaterialIcons' 'sports-gymnastics' reads as a gymnast/ballet pose, not
  // a workout — this is the classic Olympic-lifting pictogram (barbell
  // overhead), a closer match for CrossFit's actual training style.
  crossfit: ['mci', 'weight-lifter'] as const,
  hyrox: 'local-fire-department',
  hiit: 'bolt',
  bootcamp: 'sports',
  hike: 'hiking',
  walk: 'directions-walk',
  yoga: 'self-improvement',
  ski: 'downhill-skiing',
  workout: 'fitness-center',
} as const;

export type RivalIconName = keyof typeof ICONS;

export function RivalIcon({
  name,
  size = 24,
  color = RivalColors.textPrimary,
  style,
}: {
  name: RivalIconName;
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
}) {
  const glyph: string | readonly [string, string] = ICONS[name];
  if (Array.isArray(glyph)) {
    return <MaterialCommunityIcons name={glyph[1] as any} size={size} color={color} style={style} />;
  }
  return <MaterialIcons name={glyph as any} size={size} color={color} style={style} />;
}

// activity_type (DB value) → RivalIcon name. Mirrors ACTIVITY_ICONS keys.
const ACTIVITY_TYPE_TO_ICON: Record<string, RivalIconName> = {
  Run: 'run', VirtualRun: 'run',
  Ride: 'ride', VirtualRide: 'ride',
  Swim: 'swim',
  Rowing: 'rowing',
  WeightTraining: 'weights', Workout: 'workout',
  CrossFit: 'crossfit',
  Hyrox: 'hyrox',
  HIIT: 'hiit',
  Bootcamp: 'bootcamp',
  Hike: 'hike',
  Walk: 'walk',
  Yoga: 'yoga',
  AlpineSki: 'ski', NordicSki: 'ski',
};

export function activityIconName(type: string | null | undefined): RivalIconName {
  return ACTIVITY_TYPE_TO_ICON[type ?? ''] ?? 'workout';
}
