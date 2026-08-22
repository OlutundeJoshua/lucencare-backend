import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { User } from 'src/modules/auth/entities/user.entity';

import { ChatMessageDto } from './dto/chat.dto';

interface GroqChoice {
  message?: { role?: string; content?: string };
}

interface GroqResponse {
  choices?: GroqChoice[];
}

function buildSystemPrompt(userName: string): string {
  return `You are Lucy, a compassionate and knowledgeable health assistant built into the Lucen Care patient portal in Nigeria. You are speaking with ${userName}. Always address them by name naturally in your responses — especially when greeting them.

You help patients understand their health conditions, medications, appointment preparation, and care plans.

Be warm, clear, and concise. Use bullet points for lists. Avoid jargon. Always encourage patients to consult their healthcare team for clinical decisions — never diagnose or recommend dosage changes. Keep responses under 250 words unless the question genuinely requires more detail.`;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) {}

  async chat(userId: string, messages: ChatMessageDto[]): Promise<{ reply: string }> {
    const apiKey = this.configService.get<string>('ai.groqApiKey');
    if (!apiKey) {
      // Deliberately not a 500: the service is correctly built but unconfigured,
      // and the message must not hint at key material either way.
      this.logger.error('GROQ_API_KEY is not configured — /ai/chat cannot serve requests');
      throw new ServiceUnavailableException('The AI assistant is not available right now.');
    }

    // The name comes from the authenticated user, never the request body — the
    // system prompt interpolates it, so a client-supplied name would be a way to
    // inject instructions into it.
    const firstName = await this.resolveFirstName(userId);

    const maxHistory = this.configService.get<number>('ai.maxHistoryMessages', 20);
    const recent = messages.slice(-maxHistory);

    const body = {
      model: this.configService.get<string>('ai.groqModel'),
      max_tokens: this.configService.get<number>('ai.maxTokens'),
      messages: [
        { role: 'system', content: buildSystemPrompt(firstName) },
        ...recent.map(m => ({ role: m.role, content: m.content })),
      ],
    };

    const baseUrl = this.configService.get<string>('ai.groqBaseUrl');
    const timeoutMs = this.configService.get<number>('ai.requestTimeoutMs', 30_000);

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      // Covers both the timeout abort and outright connection failures.
      this.logger.error(`Groq request failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException('The AI assistant is taking too long to respond.');
    }

    if (!response.ok) {
      // Log the upstream detail for us; return a generic message to the patient so
      // provider internals and quota state stay server-side.
      const detail = await response.text().catch(() => '<unreadable>');
      this.logger.error(`Groq returned ${response.status}: ${detail.slice(0, 500)}`);
      throw new ServiceUnavailableException('The AI assistant is not available right now.');
    }

    const payload = (await response.json()) as GroqResponse;
    const reply = payload.choices?.[0]?.message?.content?.trim();

    if (!reply) {
      this.logger.warn('Groq returned a response with no message content');
      return { reply: 'Sorry, I could not generate a response right now. Please try again.' };
    }

    return { reply };
  }

  /**
   * Falls back to a neutral address rather than failing the turn — a missing
   * display name is a cosmetic problem, not a reason to lose the message.
   */
  private async resolveFirstName(userId: string): Promise<string> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'name'],
    });
    return user?.name?.trim().split(/\s+/)[0] ?? 'there';
  }
}
