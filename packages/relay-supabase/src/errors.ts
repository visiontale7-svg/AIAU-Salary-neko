import type { SupabaseErrorLike, SupabaseResult } from "./client-like";

export class RelaySupabaseError extends Error {
  readonly code?: string;
  readonly details?: string;
  readonly hint?: string;

  constructor(operation: string, error: SupabaseErrorLike) {
    super(`${operation}: ${error.message}`);
    this.name = "RelaySupabaseError";
    this.code = error.code;
    this.details = error.details;
    this.hint = error.hint;
  }
}

export function requireData<T>(operation: string, result: SupabaseResult<T>): T {
  if (result.error) throw new RelaySupabaseError(operation, result.error);
  if (result.data === null) throw new Error(`${operation}: Supabase returned no data`);
  return result.data;
}

export function requireArray(operation: string, result: SupabaseResult<unknown>): Record<string, unknown>[] {
  const value = requireData(operation, result);
  if (!Array.isArray(value)) throw new Error(`${operation}: expected an array`);
  return value.map((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(`${operation}: row ${index} is invalid`);
    }
    return row as Record<string, unknown>;
  });
}

export function requireObject(operation: string, result: SupabaseResult<unknown>): Record<string, unknown> {
  const value = requireData(operation, result);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${operation}: expected an object`);
  }
  return value as Record<string, unknown>;
}
