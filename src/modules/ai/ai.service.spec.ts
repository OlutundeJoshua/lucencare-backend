import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { User } from 'src/modules/auth/entities/user.entity';

import { AiService } from './ai.service';
import { ChatRole } from './dto/chat.dto';

const USER_ID = '01HZZZZZZZZZZZZZZZZZZZZZA1';

const CONFIG: Record<string, unknown> = {
  'ai.groqApiKey': 'test-key',
  'ai.groqBaseUrl': 'https://api.groq.test/openai/v1',
  'ai.groqModel': 'openai/gpt-oss-120b',
  'ai.maxTokens': 1024,
  'ai.requestTimeoutMs': 30_000,
  'ai.maxHistoryMessages': 20,
};

function groqOk(content: string) {
  return {
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue({ choices: [{ message: { role: 'assistant', content } }] }),
  } as unknown as Response;
}

describe('AiService', () => {
  let service: AiService;
  let userRepo: { findOne: jest.Mock };
  let config: Record<string, unknown>;
  let fetchMock: jest.Mock;

  beforeEach(async () => {
    config = { ...CONFIG };
    userRepo = { findOne: jest.fn().mockResolvedValue({ id: USER_ID, name: 'Amaka Obi' }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: unknown) => config[key] ?? fallback),
          },
        },
        { provide: getRepositoryToken(User), useValue: userRepo },
      ],
    }).compile();

    service = module.get<AiService>(AiService);

    fetchMock = jest.fn().mockResolvedValue(groqOk('Here is some guidance.'));
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => jest.restoreAllMocks());

  const history = [{ role: ChatRole.USER, content: 'What is my blood pressure target?' }];

  it('returns the assistant reply from the provider', async () => {
    await expect(service.chat(USER_ID, history)).resolves.toEqual({
      reply: 'Here is some guidance.',
    });
  });

  it('prepends a system prompt naming the authenticated user, ignoring the request body', async () => {
    await service.chat(USER_ID, history);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.messages[0].role).toBe('system');
    // First name resolved from the User record, not sent by the client.
    expect(body.messages[0].content).toContain('Amaka');
    expect(body.messages[1]).toEqual({ role: 'user', content: history[0].content });
  });

  it('sends the key as a bearer token to the configured provider URL', async () => {
    await service.chat(USER_ID, history);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.groq.test/openai/v1/chat/completions');
    expect(init.headers.authorization).toBe('Bearer test-key');
  });

  it('truncates history to maxHistoryMessages, keeping the most recent turns', async () => {
    config['ai.maxHistoryMessages'] = 2;
    const long = Array.from({ length: 6 }, (_, i) => ({
      role: ChatRole.USER,
      content: `msg-${i}`,
    }));

    await service.chat(USER_ID, long);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    // 1 system + the last 2 of 6.
    expect(body.messages).toHaveLength(3);
    expect(body.messages[1].content).toBe('msg-4');
    expect(body.messages[2].content).toBe('msg-5');
  });

  it('is unavailable, and does not call the provider, when no key is configured', async () => {
    config['ai.groqApiKey'] = undefined;

    await expect(service.chat(USER_ID, history)).rejects.toThrow(ServiceUnavailableException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not leak upstream error detail to the caller', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: jest.fn().mockResolvedValue('{"error":{"message":"Invalid API Key: gsk_secret"}}'),
    } as unknown as Response);

    await expect(service.chat(USER_ID, history)).rejects.toThrow(
      'The AI assistant is not available right now.',
    );
  });

  it('surfaces a timeout as a service-unavailable rather than an unhandled rejection', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('The operation was aborted'), {
      name: 'TimeoutError',
    }));

    await expect(service.chat(USER_ID, history)).rejects.toThrow(ServiceUnavailableException);
  });

  it('falls back to a neutral greeting when the user has no display name', async () => {
    userRepo.findOne.mockResolvedValue({ id: USER_ID, name: null });

    await service.chat(USER_ID, history);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.messages[0].content).toContain('there');
  });

  it('returns a friendly fallback when the provider replies with no content', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ choices: [] }),
    } as unknown as Response);

    const { reply } = await service.chat(USER_ID, history);
    expect(reply).toContain('could not generate a response');
  });
});
