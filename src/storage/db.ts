import Database from 'better-sqlite3';
import { dirname } from 'path';
import { mkdirSync } from 'fs';
const SCHEMA_SQL = `
-- ─── SQLite Schema for PπBot ──────────────────────────────────────
-- Phase 4: Session Persistence
--
-- This schema stores conversation sessions and their turns.

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,               -- UUID
    created_at INTEGER NOT NULL,       -- Unix timestamp (ms)
    updated_at INTEGER NOT NULL,       -- Unix timestamp (ms)
    title TEXT,                        -- Auto-generated or user-provided summary
    project_root TEXT NOT NULL,        -- Absolute path to project when session started
    total_input_tokens INTEGER DEFAULT 0,
    total_output_tokens INTEGER DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active' -- 'active', 'completed', 'archived'
);

CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at DESC);

-- Turns table (each Think-Act-Observe iteration is a turn)
CREATE TABLE IF NOT EXISTS turns (
    id TEXT PRIMARY KEY,               -- UUID
    session_id TEXT NOT NULL,          -- FK to sessions.id
    turn_index INTEGER NOT NULL,       -- 0-based index within the session
    created_at INTEGER NOT NULL,       -- Unix timestamp (ms)
    
    -- The raw JSON message array representing this turn
    -- (includes the user input, model response, and tool results)
    messages_json TEXT NOT NULL,       

    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_turns_session_index ON turns(session_id, turn_index ASC);
`;

export interface DatabaseConfig {
  /** Path to the SQLite database file */
  dbPath: string;
}

/**
 * Initializes and returns a better-sqlite3 database connection.
 * Sets up WAL mode for concurrency and applies the schema.
 */
export function getDatabase(config: DatabaseConfig): Database.Database {
  // Ensure directory exists
  mkdirSync(dirname(config.dbPath), { recursive: true });

  const db = new Database(config.dbPath, {
    // verbose: console.log
  });

  // Performance pragmas
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000'); // 64MB cache
  db.pragma('foreign_keys = ON');

  // Initialize schema
  db.exec(SCHEMA_SQL);

  return db;
}
