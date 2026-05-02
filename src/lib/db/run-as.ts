// `app.user_id` GUC helper.
//
// Surviving Postgres RPCs (process_withdrawal, admin_review_withdrawal,
// speed_execute_trade, etc.) read `app.user_id()` to identify the caller.
// That helper reads `current_setting('app.user_id', true)` which only
// returns the value set within the current transaction (`set_config(..., true)`
// is transaction-scoped).
//
// `runAs(userId, fn)` opens a transaction, sets the GUC, then runs `fn`
// against that same transaction's Drizzle handle. When the transaction
// commits, the GUC reset is automatic.
//
// Webhooks (3pay, Whish) call `process_deposit` WITHOUT runAs — service
// role bypass.

import { db } from "./index";
import { sql } from "drizzle-orm";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

type Tx = PgTransaction<NodePgQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>;

export async function runAs<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    // Quote-safe: pass userId as a parameter, NOT string-concat'd into SQL.
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}::text, true)`);
    return fn(tx);
  });
}
