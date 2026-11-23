import { io, Socket } from 'socket.io-client';

export interface LocalPrinterInfo {
  name: string;
  isDefault?: boolean;
}

/**
 * Client bridge to local `electron-hiprint` desktop daemon (ws://127.0.0.1:17521)
 * enabling zero-dialog silent dot-matrix printing on legacy 241x140mm / 241x93mm printers.
 */
export class NeedlePrinterBridge {
  private socket: Socket | null = null;
  public connected = false;
  public printers: LocalPrinterInfo[] = [];

  connect(onStatusChange?: (connected: boolean, printers: LocalPrinterInfo[]) => void) {
    try {
      this.socket = io('http://127.0.0.1:17521', {
        transports: ['websocket'],
        reconnectionAttempts: 2,
        timeout: 1800,
      });

      this.socket.on('connect', () => {
        this.connected = true;
        this.socket?.emit('refreshPrinterList');
        onStatusChange?.(true, this.printers);
      });

      this.socket.on('printerList', (list: LocalPrinterInfo[]) => {
        this.printers = list || [];
        onStatusChange?.(true, this.printers);
      });

      this.socket.on('disconnect', () => {
        this.connected = false;
        onStatusChange?.(false, []);
      });

      this.socket.on('connect_error', () => {
        this.connected = false;
        onStatusChange?.(false, []);
      });
    } catch {
      this.connected = false;
      onStatusChange?.(false, []);
    }
  }

  silentPrint(params: {
    printer?: string;
    template: unknown;
    data: unknown;
    copies?: number;
  }): boolean {
    if (!this.connected || !this.socket) return false;
    this.socket.emit('news', {
      printer: params.printer,
      template: params.template,
      data: params.data,
      copies: params.copies ?? 1,
      type: 'hiprint',
    });
    return true;
  }

  disconnect() {
    this.socket?.disconnect();
    this.socket = null;
  }
}
