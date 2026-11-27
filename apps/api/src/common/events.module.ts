import { Global, Module } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  cors: { origin: '*' },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  handleConnection(_client: Socket) {
    // Connected clients may join their org/warehouse room for targeted alerts
  }

  handleDisconnect(_client: Socket) {
    // Cleanup handled automatically by socket.io
  }

  @SubscribeMessage('join_org')
  handleJoinOrg(client: Socket, payload: { orgId: string; orgType?: string }) {
    if (payload?.orgId) {
      client.join(`org:${payload.orgId}`);
    }
    if (payload?.orgType === 'HQ') {
      client.join('role:HQ');
    }
    return { joined: true };
  }

  notifyNewOrder(orgId: string, payload: { docNo: string; customerName: string; totalAmount: number; warehouseId: string }) {
    this.server?.to(`org:${orgId}`).emit('warehouse:new_order', payload);
    this.server?.to('role:HQ').emit('warehouse:new_order', payload);
  }

  notifyAlert(payload: { id: string; alertType: string; title: string; severity: string }) {
    this.server?.to('role:HQ').emit('compliance:new_alert', payload);
  }

  notifyScanActivity(
    orgIds: Array<string | null | undefined>,
    payload: {
      actionType: 'REGISTER_INBOUND' | 'HQ_INBOUND' | 'DEALER_INBOUND' | 'HQ_OUTBOUND' | 'DEALER_OUTBOUND';
      actionLabel: string;
      docNo: string;
      operatorName: string;
      unitCount: number;
      warehouseName?: string;
      targetName?: string;
      sampleToken?: string;
      occurredAt: string;
    },
  ) {
    const rooms = new Set<string>(['role:HQ']);
    for (const id of orgIds) {
      if (id) rooms.add(`org:${id}`);
    }
    let emitter = this.server as any;
    for (const room of rooms) {
      emitter = emitter?.to(room);
    }
    emitter?.emit('trace:scan_activity', payload);
  }
}

@Global()
@Module({
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class EventsModule {}
