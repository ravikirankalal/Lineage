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

/** Our launch cover (android/…/LaunchCoverPlugin.java): the logo on green, on top of the page while it loads. */
const LaunchCover = registerPlugin<{ hide(): Promise<void> }>('LaunchCover');

/**
 * Remove the app's launch cover once the page has something to show (capped at 10 s in MainActivity).
 * Apps built before 1.0.13 don't have it: nothing to do then.
 */
export function hideSplash(): void {
  if (!isNativeApp()) return;
  // Wait for the page to be painted, so the cover never reveals a half-drawn screen.
  requestAnimationFrame(() => requestAnimationFrame(() => { void LaunchCover.hide().catch(() => {}); }));
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
