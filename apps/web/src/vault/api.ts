/**
 * Vault API client (Epic 13, F1221–F1240).
 *
 * Wraps the five /vault/* endpoints.  All responses follow the standard
 * { data } / { error: { code, message } } envelope already handled by
 * apps/web/src/api/client.ts.
 */
import { api } from '../api/client.js';

export type VaultStatus = 'absent' | 'locked' | 'unlocked';

export interface VaultStatusData {
  status: VaultStatus;
}

export const vaultApi = {
  /** GET /vault/status — absent | locked | unlocked */
  status: (): Promise<VaultStatusData> => api.get<VaultStatusData>('/vault/status'),

  /**
   * POST /vault — create a new vault.
   * 409 CONFLICT if one already exists.
   */
  create: (passphrase: string, strength?: number): Promise<VaultStatusData> =>
    api.post<VaultStatusData>('/vault', {
      passphrase,
      ...(strength !== undefined ? { strength } : {}),
    }),

  /** POST /vault/unlock — 403 FORBIDDEN on wrong passphrase. */
  unlock: (passphrase: string): Promise<VaultStatusData> =>
    api.post<VaultStatusData>('/vault/unlock', { passphrase }),

  /** POST /vault/lock */
  lock: (): Promise<VaultStatusData> => api.post<VaultStatusData>('/vault/lock'),

  /**
   * POST /vault/passphrase — change passphrase.
   * 403 FORBIDDEN if current is wrong.
   */
  changePassphrase: (current: string, next: string): Promise<VaultStatusData> =>
    api.post<VaultStatusData>('/vault/passphrase', { current, next }),
};
