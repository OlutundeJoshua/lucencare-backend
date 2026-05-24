// TODO: Implement — see docs/modules/gateways.md

import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({ namespace: '/notifications', cors: { origin: '*' } })
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  handleConnection(_client: Socket) {
    // Auth happens on first message frame — validate JWT here
  }

  handleDisconnect(_client: Socket) {
    // Cleanup subscriptions
  }

  pushToUser(_userId: string, _payload: object) {
    // Emit to user-specific room after DB insert
  }
}
