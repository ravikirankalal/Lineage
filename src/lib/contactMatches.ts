/**
 * Which people in the tree are in the user's contacts (Google contacts on the web, the phone's
 * contacts in the app). Contacts stay in memory for the visit; nothing is stored.
 */
import { useGoogleContacts } from './cloud/googleContacts';
import { matchContacts, type ContactSuggestion } from './contactSuggest';
import { useData } from './data';
import type { Person } from './types';

const EMPTY = new Map<string, ContactSuggestion>();
// One match per (contacts, people) pair, shared by every list row and card that asks.
let last: { contacts: readonly ContactSuggestion[]; people: readonly Person[]; result: Map<string, ContactSuggestion> } | null = null;

export function useContactMatches(): Map<string, ContactSuggestion> {
  const { contacts } = useGoogleContacts();
  const { people } = useData();
  if (!contacts.length) return EMPTY;
  if (last?.contacts !== contacts || last.people !== people) last = { contacts, people, result: matchContacts(people, contacts) };
  return last.result;
}
