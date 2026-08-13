import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreatePostDto } from './create-post.dto';

async function errorsFor(payload: Record<string, unknown>) {
  return validate(plainToInstance(CreatePostDto, payload));
}

describe('CreatePostDto', () => {
  it('accepts a body on its own — a title is optional', async () => {
    expect(await errorsFor({ body: 'Any tips for the nausea?' })).toHaveLength(0);
  });

  it('rejects a missing body', async () => {
    expect((await errorsFor({ title: 'Just a title' })).map((e) => e.property)).toContain('body');
  });

  it('rejects a whitespace-only body, which trimming turns into nothing', async () => {
    expect((await errorsFor({ body: '   \n  ' })).map((e) => e.property)).toContain('body');
  });

  it('trims the body and title', async () => {
    const dto = plainToInstance(CreatePostDto, { title: '  Metformin  ', body: '  Any tips?  ' });
    expect(dto.title).toBe('Metformin');
    expect(dto.body).toBe('Any tips?');
  });

  it('rejects a body beyond the length cap', async () => {
    expect((await errorsFor({ body: 'x'.repeat(5001) })).map((e) => e.property)).toContain('body');
  });

  it('rejects more than eight tags', async () => {
    const tags = Array.from({ length: 9 }, (_, i) => `tag${i}`);
    expect((await errorsFor({ body: 'hi', tags })).map((e) => e.property)).toContain('tags');
  });

  it('rejects a non-string tag', async () => {
    expect((await errorsFor({ body: 'hi', tags: [42] })).map((e) => e.property)).toContain('tags');
  });
});
