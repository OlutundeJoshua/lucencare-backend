import { normaliseGroqBaseUrl } from './ai.config';

describe('normaliseGroqBaseUrl', () => {
  // The regression this exists for: the bare host is what the retired Angular
  // dev-server proxy used as its target, so it is the value most likely to be
  // pasted in. Left as-is it 404s on every chat turn.
  it('appends the API path to a bare host', () => {
    expect(normaliseGroqBaseUrl('https://api.groq.com')).toBe('https://api.groq.com/openai/v1');
  });

  it('appends the API path to a bare host with a trailing slash', () => {
    expect(normaliseGroqBaseUrl('https://api.groq.com/')).toBe('https://api.groq.com/openai/v1');
  });

  it('leaves a base that already carries the API path alone', () => {
    expect(normaliseGroqBaseUrl('https://api.groq.com/openai/v1')).toBe(
      'https://api.groq.com/openai/v1',
    );
  });

  it('strips a trailing slash so the joined path has no double separator', () => {
    expect(normaliseGroqBaseUrl('https://api.groq.com/openai/v1/')).toBe(
      'https://api.groq.com/openai/v1',
    );
  });

  it('respects an unrelated path, so mocks and proxies can point anywhere', () => {
    expect(normaliseGroqBaseUrl('http://localhost:9999/mock')).toBe('http://localhost:9999/mock');
  });

  it('trims surrounding whitespace', () => {
    expect(normaliseGroqBaseUrl('  https://api.groq.com  ')).toBe('https://api.groq.com/openai/v1');
  });

  it('passes a non-URL through rather than inventing a working one', () => {
    expect(normaliseGroqBaseUrl('not a url')).toBe('not a url');
  });
});
