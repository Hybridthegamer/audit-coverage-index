import "server-only";

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema";

// HTTP driver (not TCP): serverless functions can't hold a connection pool.
// `neon()` opens a stateless SQL-over-HTTP connection per query.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set");
}

const sql = neon(databaseUrl);

export const db = drizzle(sql, { schema });

export type DB = typeof db;
