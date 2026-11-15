import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Lineage for Android: a native shell around the live site (https://lineage-d575c.web.app), so every
 * website update reaches the app without reinstalling. Native parts:
 * - Google sign-in through Android's Credential Manager (@capgo/capacitor-social-login): Google refuses
 *   its sign-in page inside embedded browsers, so the web popup can't be used in the app.
 * - Reading the phone's contacts (read-only, our own ContactsReader plugin in android/), as suggestions
 *   when adding a relative. Nothing is stored except the person you pick.
 */
const config: CapacitorConfig = {
  appId: 'app.lineage.family',
  appName: 'Lineage',
  webDir: 'dist',
  server: {
    url: 'https://lineage-d575c.web.app',
    androidScheme: 'https',
    // Only the app's own site loads inside the app; other links open in the browser.
    allowNavigation: ['lineage-d575c.web.app', 'lineage-d575c.firebaseapp.com'],
  },
  android: { allowMixedContent: false },
  plugins: {
    SocialLogin: { providers: { google: true, facebook: false, apple: false, twitter: false } },
  },
};

export default config;
