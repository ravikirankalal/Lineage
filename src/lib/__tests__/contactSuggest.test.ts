import { describe, expect, it } from 'vitest';
import { contactToPerson, fromGooglePerson, fromPicked, suggestContacts, type ContactSuggestion } from '../contactSuggest';
import { emptyPerson } from '../person';

// Fictitious contacts only.
const g = (given: string, family: string, phone?: string, extra: object = {}) =>
  fromGooglePerson({ resourceName: `people/${given}`, names: [{ givenName: given, familyName: family }], phoneNumbers: phone ? [{ value: phone }] : [], ...extra })!;

describe('contact suggestions', () => {
  it('maps Google people: names, phones, emails, gender; skips number-only entries', () => {
    const c = fromGooglePerson({
      resourceName: 'people/c1', names: [{ displayName: 'Asha Verma' }], nicknames: [{ value: 'Ashu' }],
      phoneNumbers: [{ value: '+91 90000 11111' }, { value: '+91 90000 11111' }], emailAddresses: [{ value: 'asha@example.com' }], genders: [{ value: 'female' }],
    })!;
    expect(c).toMatchObject({ firstName: 'Asha', lastName: 'Verma', nickname: 'Ashu', phones: ['+91 90000 11111'], emails: ['asha@example.com'], gender: 'female', from: 'google' });
    expect(fromGooglePerson({ resourceName: 'people/c2', phoneNumbers: [{ value: '12345' }] })).toBeNull();
  });

  it('maps a picked phone contact', () => {
    expect(fromPicked({ name: ['Ravi Teja Rao'], tel: ['98480 00009'] })).toMatchObject({ firstName: 'Ravi Teja', lastName: 'Rao', phones: ['98480 00009'], from: 'phone' });
  });

  it('matches every word of the name, nickname or digits, and leaves out people already in the tree', () => {
    const list: ContactSuggestion[] = [g('Asha', 'Verma', '90000 11111'), g('Asha', 'Rao', '90000 22222'), g('Meera', 'Iyer', '90000 33333')];
    const tree = [emptyPerson({ firstName: 'Someone', phones: [{ label: 'mobile', value: '+91 90000 22222' }] }), emptyPerson({ firstName: 'Meera', lastName: 'Iyer' })];
    expect(suggestContacts(list, 'asha', tree).map((c) => c.lastName)).toEqual(['Verma']); // Asha Rao's number is in the tree
    expect(suggestContacts(list, 'asha ver', []).map((c) => c.lastName)).toEqual(['Verma']);
    expect(suggestContacts(list, '33333', [])).toHaveLength(1);
    expect(suggestContacts(list, 'meera', tree)).toEqual([]); // same full name already in the tree
    expect(suggestContacts(list, '', [])).toEqual([]);
  });

  it('a picked contact becomes a hand-added person, gender from the contact or the chosen relation', () => {
    const p = contactToPerson(g('Kiran', 'Das', '90000 44444'), 'male');
    expect(p).toMatchObject({ firstName: 'Kiran', lastName: 'Das', gender: 'male', source: 'manual', phones: [{ label: 'mobile', value: '90000 44444' }] });
  });
});
