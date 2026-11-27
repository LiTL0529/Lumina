import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export interface NativeScanOpenOptions {
  continuous?: boolean;
  title?: string;
  hint?: string;
  apiBaseUrl?: string;
  authToken?: string;
  workMode?: 'INBOUND' | 'OUTBOUND' | 'TRACE';
  validateMode?:
    | 'REGISTER_INBOUND'
    | 'HQ_INBOUND'
    | 'DEALER_INBOUND'
    | 'HQ_OUTBOUND'
    | 'DEALER_OUTBOUND'
    | '';
  warehouseId?: string;
  productId?: string;
  codeLevel?: 'UNIT' | 'CARTON';
  batchNo?: string;
  existingCodes?: string[];
  confirmBeforeAdd?: boolean;
}

export interface NativeScanResult {
  cancelled?: boolean;
  text?: string;
  format?: string;
  source?: 'camera' | 'gallery' | 'continuous';
  count?: number;
  confirmedCodes?: string[];
  openManual?: boolean;
}

export interface LuminaScannerPlugin {
  openScanner(options?: NativeScanOpenOptions): Promise<NativeScanResult>;
  pickAndDecodeImage(): Promise<NativeScanResult>;
  addListener(
    eventName: 'scanResult',
    listenerFunc: (event: { text: string; format?: string; source?: string }) => void,
  ): Promise<PluginListenerHandle>;
}

export const LuminaScanner = registerPlugin<LuminaScannerPlugin>('LuminaScanner');

export function isNativeAndroidScanner(): boolean {
  try {
    return (
      Capacitor.isNativePlatform() &&
      Capacitor.getPlatform() === 'android' &&
      Capacitor.isPluginAvailable('LuminaScanner')
    );
  } catch {
    return false;
  }
}
