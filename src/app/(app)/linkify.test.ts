import { describe, expect, it } from 'vitest';
import { URL_PATTERN } from './linkify';

describe('URL_PATTERN', () => {
  it.each([
    ['See https://bahn.de.', 'https://bahn.de'],
    ['Tickets: https://x.de/a?b=1, then go', 'https://x.de/a?b=1'],
    ['(https://x.de/p)', 'https://x.de/p'],
    ['Really https://x.de/a.html!', 'https://x.de/a.html'],
  ])('leaves closing punctuation out of the link in %j', (text, link) => {
    expect(text.match(URL_PATTERN)).toEqual([link]);
  });

  it('only links https', () => {
    expect('http://x.de javascript:alert(1)'.match(URL_PATTERN)).toBeNull();
  });
});
