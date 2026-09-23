// Expo generates expo-env.d.ts with this same reference, but that file is
// gitignored by design, so a fresh checkout — CI, or a new machine — has no
// declarations for side-effect imports like `import './global.css'` and the
// typecheck fails on them. Referencing expo's types from a committed file
// makes the typecheck behave the same everywhere.
/// <reference types="expo/types" />
