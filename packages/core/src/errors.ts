export const ERROR_CODES = [
  'BAD_REQUEST',
  'VALIDATION',
  'NOT_FOUND',
  'CONFLICT',
  'FORBIDDEN',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface AppErrorOptions {
  cause?: unknown;
  /** Safe-to-serialize structured context (never secrets). */
  details?: Record<string, unknown>;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: Record<string, unknown> | null;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.details = options.details ?? null;
  }

  toJSON(): { code: ErrorCode; message: string; details: Record<string, unknown> | null } {
    return { code: this.code, message: this.message, details: this.details };
  }
}

export const notFound = (what: string, id?: string): AppError =>
  new AppError('NOT_FOUND', `${what} not found`, id === undefined ? {} : { details: { id } });

export const validation = (message: string, details?: Record<string, unknown>): AppError =>
  new AppError('VALIDATION', message, details === undefined ? {} : { details });

export const conflict = (message: string, details?: Record<string, unknown>): AppError =>
  new AppError('CONFLICT', message, details === undefined ? {} : { details });

export const internal = (message: string, cause?: unknown): AppError =>
  new AppError('INTERNAL', message, cause === undefined ? {} : { cause });

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
