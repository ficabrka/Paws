# Paws 🐾

The world's cutest pets in one swipe. Expo (React Native) app for Android and iOS, backed by Supabase.

- `App.js`: screens (feed, top list, post, my pets)
- `src/lib.js`: Supabase client, translations helper, data helpers
- `src/Detector.js`: on-device animal check (MobileNet v2 in a hidden WebView)
- `src/i18n.json`: 13 languages
- `.github/workflows/android.yml`: every push to `main` builds a test APK and attaches it to a GitHub release
