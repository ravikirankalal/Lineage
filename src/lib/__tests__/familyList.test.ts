import { describe, expect, it } from 'vitest';
import { emptyPerson, familyLinkedIds, inFamilyList } from '../person';
import type { Relationship } from '../types';

// Invented people only: the repository is public.
const rel = (id: string, fromId: string, toId: string, type: Relationship['type']): Relationship => ({ id, fromId, toId, type, createdAt: 1 });

describe('People page shows family, not loose contacts', () => {
  const me = emptyPerson({ id: 'me', firstName: 'Ann', isMe: true, source: 'vcard' });
  const mum = emptyPerson({ id: 'mum', firstName: 'Bea', source: 'google' }); // a contact linked as mother
  const loose = emptyPerson({ id: 'loose', firstName: 'Cal', source: 'picker' }); // contact, no family link
  const oldFriend = emptyPerson({ id: 'pal', firstName: 'Dee', source: 'csv' }); // only a non-family link
  const typed = emptyPerson({ id: 'typed', firstName: 'Eve' }); // added by hand, not linked yet
  const rels = [rel('r1', 'mum', 'me', 'parent'), rel('r2', 'me', 'pal', 'friend')];
  const linked = familyLinkedIds(rels);

  it('counts only family links', () => {
    expect([...linked].sort()).toEqual(['me', 'mum']);
  });
  it('lists me, linked contacts and hand-added people; hides loose contacts', () => {
    const shown = [me, mum, loose, oldFriend, typed].filter((p) => inFamilyList(p, linked)).map((p) => p.id);
    expect(shown).toEqual(['me', 'mum', 'typed']);
  });
});
