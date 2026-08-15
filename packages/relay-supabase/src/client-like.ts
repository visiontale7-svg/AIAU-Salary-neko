export interface SupabaseErrorLike {
  code?: string;
  message: string;
  details?: string;
  hint?: string;
}

export interface SupabaseResult<T = unknown> {
  data: T | null;
  error: SupabaseErrorLike | null;
  count?: number | null;
}

export interface SupabaseQueryBuilderLike extends PromiseLike<SupabaseResult<unknown>> {
  select(columns?: string): SupabaseQueryBuilderLike;
  eq(column: string, value: unknown): SupabaseQueryBuilderLike;
  gt(column: string, value: unknown): SupabaseQueryBuilderLike;
  order(column: string, options?: { ascending?: boolean }): SupabaseQueryBuilderLike;
  limit(count: number): SupabaseQueryBuilderLike;
  single(): PromiseLike<SupabaseResult<unknown>>;
  maybeSingle(): PromiseLike<SupabaseResult<unknown>>;
}

export interface RealtimePresenceMetaLike {
  [key: string]: unknown;
}

export type RealtimePresenceStateLike = Record<string, RealtimePresenceMetaLike[]>;

export interface RealtimeChannelLike {
  on(
    type: "broadcast" | "presence",
    filter: Record<string, unknown>,
    callback: (payload: { payload?: unknown }) => void,
  ): RealtimeChannelLike;
  subscribe(callback?: (status: string, error?: Error) => void): RealtimeChannelLike;
  track(payload: Record<string, unknown>): PromiseLike<unknown>;
  untrack(): PromiseLike<unknown>;
  send(payload: { type: "broadcast"; event: string; payload: Record<string, unknown> }): PromiseLike<unknown>;
  presenceState(): RealtimePresenceStateLike;
  unsubscribe(): PromiseLike<unknown>;
}

export interface SupabaseClientLike {
  auth: {
    getUser(): PromiseLike<SupabaseResult<{ user: { id: string } | null }>>;
  };
  from(table: string): SupabaseQueryBuilderLike;
  rpc(functionName: string, args?: Record<string, unknown>): PromiseLike<SupabaseResult<unknown>>;
  channel(
    topic: string,
    options?: {
      config?: {
        private?: boolean;
        broadcast?: { ack?: boolean; self?: boolean };
        presence?: { key?: string };
      };
    },
  ): RealtimeChannelLike;
  functions: {
    invoke(
      functionName: string,
      options: { body: Record<string, unknown> },
    ): PromiseLike<SupabaseResult<unknown>>;
  };
}
