/**
 * User-created tasks — what a WeChat user can build through natural language.
 *
 * Two trigger families, generic enough to cover most "remind me / alert me"
 * use cases:
 *
 *   1. `reminder` — fires at one or more points in time
 *        - kind: 'once'  → fires once at `runAt` (unix ms)
 *        - kind: 'cron'  → recurring, standard cron expression
 *
 *   2. `watch` — polls an HTTP endpoint on a cron schedule, extracts a
 *      value via JSON path, evaluates a condition; on match it delivers
 *      the rendered message and (by default) disables itself.
 *
 * Both deliver via the outbox (or a future direct sender). A task is
 * owned by one conversation — only that conversation can list/edit it.
 */

export type TaskType = 'reminder' | 'watch';

export interface ReminderSchedule {
  kind: 'once' | 'cron';
  /** Unix-ms timestamp for kind=once. */
  runAt?: number;
  /** Standard 5-field cron expression for kind=cron. */
  cron?: string;
}

export interface WatchFetcher {
  /** Currently only HTTP is supported (covers the long tail with jsonPath). */
  type: 'http';
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  /** Body for POST requests. */
  body?: string;
  /**
   * Dotted JSON path into the response body, e.g. `data.price` or
   * `quote.regularMarketPrice`. Array indexing: `items.0.value`.
   * Omit to use the raw response text.
   */
  jsonPath?: string;
}

export type WatchOp = '<' | '>' | '<=' | '>=' | '==' | '!=' | 'contains' | 'not_contains' | 'changes';

export interface WatchCondition {
  op: WatchOp;
  /** Reference value to compare against; for `changes`, the previously seen value. */
  value?: string | number;
}

export interface WatchSpec {
  /** Polling cron. Defaults to every 5 minutes if absent. */
  pollCron: string;
  fetcher: WatchFetcher;
  condition: WatchCondition;
  /** If true (default), disable the task after the first match. */
  oneShot?: boolean;
}

export interface UserTask {
  id: string;
  ownerConversationId: string;
  /** Short summary of what the task is, in the user's language. */
  description: string;
  type: TaskType;
  schedule?: ReminderSchedule;
  watch?: WatchSpec;
  /**
   * Template message delivered on trigger. For watch tasks, the token
   * `{value}` is replaced with the observed value.
   */
  message: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastTriggeredAt: number | null;
  triggerCount: number;
  /** Persisted previous value for `changes` condition. */
  lastSeenValue: string | null;
}

/** Shape returned by the LLM parser before we assign id/timestamps. */
export type UserTaskDraft = Omit<UserTask, 'id' | 'createdAt' | 'updatedAt' | 'lastTriggeredAt' | 'triggerCount' | 'lastSeenValue' | 'enabled'> & {
  enabled?: boolean;
};
