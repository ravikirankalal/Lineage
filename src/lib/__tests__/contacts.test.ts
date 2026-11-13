import { describe, expect, it } from 'vitest';
import { findDuplicate, mergeInto, parseContactsCSV, parseContactsFile, parseVCard, planImport } from '../contacts';
import { emptyPerson } from '../person';

const VCF = `BEGIN:VCARD
VERSION:3.0
N:Sharma;Anil;Kumar;;
FN:Anil Kumar Sharma
NICKNAME:Anu
TEL;TYPE=CELL:+91 98765 43210
TEL;TYPE=HOME:040-2345678
EMAIL;TYPE=INTERNET:anil@example.com
ADR;TYPE=HOME:;;12 MG Road;Hyderabad;Telangana;500001;India
ORG:Infosys
TITLE:Engineer
BDAY:1985-04-12
NOTE:Met at Raju's wedding\\, 2019
END:VCARD
BEGIN:VCARD
VERSION:2.1
N;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:;=E0=A4=B0=E0=A4=BE=E0=A4=AE;;;
TEL;CELL:9876500000
END:VCARD
BEGIN:VCARD
VERSION:3.0
FN:Priya Reddy
item1.TEL:+1 555 0100
item1.X-ABLabel:_$!<Mobile>!$_
END:VCARD`;

describe('vCard', () => {
  const people = parseVCard(VCF);
  it('parses all cards', () => expect(people).toHaveLength(3));
  it('parses fields', () => {
    const a = people[0];
    expect([a.firstName, a.middleName, a.lastName, a.nickname]).toEqual(['Anil', 'Kumar', 'Sharma', 'Anu']);
    expect(a.phones).toEqual([{ label: 'mobile', value: '+91 98765 43210' }, { label: 'home', value: '040-2345678' }]);
    expect(a.emails[0].value).toBe('anil@example.com');
    expect(a.address?.city).toBe('Hyderabad');
    expect(a.work[0]).toEqual({ organization: 'Infosys', role: 'Engineer' });
    expect(a.birthDate).toBe('1985-04-12');
    expect(a.notes).toBe("Met at Raju's wedding, 2019");
  });
  it('decodes quoted-printable UTF-8', () => expect(people[1].firstName).toBe('राम'));
  it('splits FN and reads Apple labels', () => {
    expect([people[2].firstName, people[2].lastName]).toEqual(['Priya', 'Reddy']);
    expect(people[2].phones[0].label).toBe('mobile');
  });
});

describe('CSV', () => {
  it('parses Google contacts export', () => {
    const csv = 'First Name,Middle Name,Last Name,Nickname,Birthday,Notes,E-mail 1 - Type,E-mail 1 - Value,Phone 1 - Type,Phone 1 - Value,Address 1 - City,Organization Name\n' +
      'Ravi,,Kumar,RK,1990-01-02,"Likes cricket, chess",* Home,ravi@x.com,Mobile,+91 90000 11111 ::: +91 90000 22222,Pune,TCS\n';
    const [p] = parseContactsCSV(csv);
    expect(p.firstName).toBe('Ravi');
    expect(p.nickname).toBe('RK');
    expect(p.notes).toBe('Likes cricket, chess');
    expect(p.phones.map((x) => x.value)).toEqual(['+91 90000 11111', '+91 90000 22222']);
    expect(p.emails[0]).toEqual({ label: 'home', value: 'ravi@x.com' });
    expect(p.address?.city).toBe('Pune');
    expect(p.work[0].organization).toBe('TCS');
  });
  it('parses Outlook export', () => {
    const csv = 'First Name,Last Name,Mobile Phone,E-mail Address,Home City\nSita,Devi,98480 12345,sita@y.com,Vizag\n';
    const [p] = parseContactsCSV(csv);
    expect(p.phones[0]).toEqual({ label: 'mobile', value: '98480 12345' });
    expect(p.emails[0].value).toBe('sita@y.com');
  });
});

describe('dedupe', () => {
  it('matches by phone ignoring country code and merges gaps', () => {
    const existing = emptyPerson({ firstName: 'Anil', phones: [{ label: 'm', value: '9876543210' }], appearance: 'tall' });
    const incoming = emptyPerson({ firstName: 'Anil S', phones: [{ label: 'mobile', value: '+91 98765 43210' }], emails: [{ label: 'e', value: 'a@b.c' }] });
    expect(findDuplicate(incoming, [existing])).toEqual({ person: existing, strength: 'strong' });
    const m = mergeInto(existing, incoming);
    expect(m.firstName).toBe('Anil');
    expect(m.phones).toHaveLength(1);
    expect(m.emails).toHaveLength(1);
    expect(m.appearance).toBe('tall');
  });

  it('matches by email as strong', () => {
    const existing = emptyPerson({ firstName: 'Meena', emails: [{ label: 'e', value: 'Meena@Example.com' }] });
    const incoming = emptyPerson({ firstName: 'M', emails: [{ label: 'home', value: 'meena@example.com ' }] });
    expect(findDuplicate(incoming, [existing])?.strength).toBe('strong');
  });

  it('does not merge same-name people whose phones disagree', () => {
    const existing = emptyPerson({ firstName: 'Ravi', lastName: 'Kumar', phones: [{ label: 'm', value: '98480 11111' }] });
    const incoming = emptyPerson({ firstName: 'Ravi', lastName: 'Kumar', phones: [{ label: 'mobile', value: '90000 22222' }] });
    expect(findDuplicate(incoming, [existing])).toBeUndefined();
  });

  it('treats a name-only match as possible when one side has no phone or email', () => {
    const bare = emptyPerson({ firstName: 'Ravi', lastName: 'Kumar' });
    const withPhone = emptyPerson({ firstName: 'ravi', lastName: 'kumar', phones: [{ label: 'm', value: '90000 22222' }] });
    expect(findDuplicate(withPhone, [bare])).toEqual({ person: bare, strength: 'possible' });
    expect(findDuplicate(bare, [withPhone])).toEqual({ person: withPhone, strength: 'possible' });
  });

  it('prefers a phone match over an earlier name match', () => {
    const sameName = emptyPerson({ firstName: 'Ravi', lastName: 'Kumar' });
    const samePhone = emptyPerson({ firstName: 'RK', phones: [{ label: 'm', value: '9000022222' }] });
    const incoming = emptyPerson({ firstName: 'Ravi', lastName: 'Kumar', phones: [{ label: 'm', value: '+91 90000 22222' }] });
    expect(findDuplicate(incoming, [sameName, samePhone])).toEqual({ person: samePhone, strength: 'strong' });
  });

  it('fills an empty address or origin object from the import', () => {
    const existing = emptyPerson({ firstName: 'Lata', address: {}, origin: { city: undefined, area: '  ' } });
    const incoming = emptyPerson({ firstName: 'Lata', address: { city: 'Pune' }, origin: { city: 'Nashik' } });
    const m = mergeInto(existing, incoming);
    expect(m.address).toEqual({ city: 'Pune' });
    expect(m.origin).toEqual({ city: 'Nashik' });
    const typed = mergeInto(emptyPerson({ firstName: 'Lata', address: { city: 'Mumbai' } }), incoming);
    expect(typed.address).toEqual({ city: 'Mumbai' });
  });
});

describe('planImport', () => {
  const vcf = 'BEGIN:VCARD\nVERSION:3.0\nFN:Kiran Rao\nTEL;TYPE=CELL:+91 91234 56789\nEND:VCARD\n';
  const csv = 'First Name,Last Name,Mobile Phone,E-mail Address,Home City\nKiran,Rao,9123456789,kiran@z.com,Mysuru\n';

  it('collapses the same contact from a .vcf and a .csv into one new row', () => {
    const plan = planImport([...parseContactsFile('a.vcf', vcf), ...parseContactsFile('b.csv', csv)], []);
    expect(plan).toHaveLength(1);
    expect(plan[0].match).toBeUndefined();
    expect(plan[0].person.phones).toHaveLength(1);
    expect(plan[0].person.emails[0].value).toBe('kiran@z.com');
    expect(plan[0].person.address?.city).toBe('Mysuru');
  });

  it('collapses duplicates that match the same existing person', () => {
    const existing = emptyPerson({ firstName: 'Kiran', phones: [{ label: 'm', value: '9123456789' }] });
    const plan = planImport([...parseContactsFile('a.vcf', vcf), ...parseContactsFile('b.csv', csv)], [existing]);
    expect(plan).toHaveLength(1);
    expect(plan[0].match).toEqual({ person: existing, strength: 'strong' });
    expect(plan[0].person.emails[0].value).toBe('kiran@z.com');
  });

  it('keeps same-name contacts with different numbers apart', () => {
    const a = emptyPerson({ firstName: 'Ravi', lastName: 'Kumar', phones: [{ label: 'm', value: '9848011111' }] });
    const b = emptyPerson({ firstName: 'Ravi', lastName: 'Kumar', phones: [{ label: 'm', value: '9000022222' }] });
    expect(planImport([a, b], [])).toHaveLength(2);
  });
});
