/**
 * TanStack Query hook for /vault/status (F1221).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { vaultApi } from './api.js';

export const VAULT_STATUS_KEY = ['vault', 'status'] as const;

/** Polls vault status; staleTime=0 so it always re-checks after focus. */
export function useVaultStatus() {
  return useQuery({
    queryKey: VAULT_STATUS_KEY,
    queryFn: vaultApi.status,
    staleTime: 0,
    retry: 1,
  });
}

export function useVaultLock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: vaultApi.lock,
    onSuccess: (data) => qc.setQueryData(VAULT_STATUS_KEY, data),
  });
}

export function useVaultCreate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ passphrase, strength }: { passphrase: string; strength?: number }) =>
      vaultApi.create(passphrase, strength),
    onSuccess: (data) => qc.setQueryData(VAULT_STATUS_KEY, data),
  });
}

export function useVaultUnlock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (passphrase: string) => vaultApi.unlock(passphrase),
    onSuccess: (data) => qc.setQueryData(VAULT_STATUS_KEY, data),
  });
}

export function useVaultChangePassphrase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ current, next }: { current: string; next: string }) =>
      vaultApi.changePassphrase(current, next),
    onSuccess: (data) => qc.setQueryData(VAULT_STATUS_KEY, data),
  });
}
