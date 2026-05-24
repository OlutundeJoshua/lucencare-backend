// V2 PLACEHOLDER ONLY — do not add business logic
// AI chat feature is deferred to V2. Key management spec required before implementation.
// See ARCHITECTURE.md §6 ChatGateway section for context.

import { WebSocketGateway } from '@nestjs/websockets';

@WebSocketGateway({ namespace: '/chat' })
export class ChatGateway {
  // V2 — not implemented
}
