/**
 * Running inside the Lineage Android app (Capacitor shell around the live site)? The app adds native
 * Google sign-in and read-only phone contacts; in a normal browser none of this loads.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

/** Our read-only contacts plugin (android/app/src/main/java/app/lineage/family/ContactsReaderPlugin.java). */
export interface NativeContact { id: string; display?: string; given?: string; family?: string; nickname?: string; phones: string[]; emails: string[] }
export const ContactsReader = registerPlugin<{ read(): Promise<{ contacts: NativeContact[] }> }>('ContactsReader');

/**
 * Hide the app's launch screen (logo on green). It stays up while the site loads, so the app never shows
 * an empty window; the page hides it once it has something to show (capped at 10 s in capacitor.config.ts).
 * Apps built before the splash plugin don't have it: nothing to do then.
 */
export function hideSplash(): void {
  if (!isNativeApp()) return;
  void import('@capacitor/splash-screen').then(({ SplashScreen }) => SplashScreen.hide({ fadeOutDuration: 200 })).catch(() => {});
}

/** The installed Android app's version (e.g. "1.0.11"); null in a browser or in apps built before 1.0.11. */
export async function nativeAppVersion(): Promise<string | null> {
  if (!isNativeApp()) return null;
  try {
    const { App } = await import('@capacitor/app');
    return (await App.getInfo()).version;
  } catch {
    return null;
  }
}

/** Web client ID of the Firebase project's Google sign-in (public; see FIREBASE_SETUP.md › Android app). */
export const GOOGLE_WEB_CLIENT_ID = String(import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID ?? '');
