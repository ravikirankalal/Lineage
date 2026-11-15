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

/** Web client ID of the Firebase project's Google sign-in (public; see FIREBASE_SETUP.md › Android app). */
export const GOOGLE_WEB_CLIENT_ID = String(import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID ?? '');
