import { describe, expect, it } from 'vitest';
import { firstEmail, hasPhone, matchPeople } from '../sharing';
import type { Person } from '../types';

// Invented people only: the repository is public.
const mk = (id: string, firstName: string, lastName: string, phone = '', email = ''): Person => ({
  id, firstName, lastName, gender: 'unknown',
  phones: phone ? [{ label: 'mobile', value: phone }] : [],
  emails: email ? [{ label: 'home', value: email }] : [],
  work: [], education: [], facts: [], tags: [], createdAt: 1, updatedAt: 1,
});

describe('sharing helpers', () => {
  it('hasPhone ignores blank numbers', () => {
    expect(hasPhone(mk('a', 'Ann', 'Oak', '+1 555 0100'))).toBe(true);
    expect(hasPhone(mk('b', 'Bo', 'Oak'))).toBe(false);
    expect(hasPhone({ phones: [{ label: 'mobile', value: '  ' }] })).toBe(false);
  });

  it('firstEmail prefills from the person', () => {
    expect(firstEmail(mk('a', 'Ann', 'Oak', '', 'Ann@Example.com'))).toBe('ann@example.com');
    expect(firstEmail(mk('b', 'Bo', 'Oak'))).toBe('');
  });

  it('matchPeople ranks word starts and people with phones first', () => {
    const people = [mk('1', 'Joanna', 'Pine'), mk('2', 'Anna', 'Elm', '555'), mk('3', 'Annabel', 'Fir'), mk('4', 'Zed', 'Ash')];
    expect(matchPeople(people, 'ann').map((p) => p.id)).toEqual(['2', '3', '1']);
    expect(matchPeople(people, '')).toEqual([]);
    expect(matchPeople(people, 'xyz')).toEqual([]);
  });
});
