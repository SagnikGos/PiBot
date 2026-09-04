import type { Database } from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { Message } from '../types/messages.js';

export interface SessionRecord {
  id: string;
  createdAt: number;
  updatedAt: number;
  title: string | null;
  projectRoot: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  status: 'active' | 'completed' | 'archived';
}

export interface TurnRecord {
  id: string;
  sessionId: string;
  turnIndex: number;
  createdAt: number;
  messages: Message[];
  inputTokens: number;
  outputTokens: number;
}

export class SessionRepository {
  constructor(private readonly db: Database) {}

  // ─── Sessions ──────────────────────────────────────────────────

  createSession(projectRoot: string): SessionRecord {
    const id = randomUUID();
    const now = Date.now();
    
    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, created_at, updated_at, project_root, status)
      VALUES (?, ?, ?, ?, 'active')
    `);
    
    stmt.run(id, now, now, projectRoot);
    
    return this.getSession(id)!;
  }

  getSession(id: string): SessionRecord | null {
    const stmt = this.db.prepare('SELECT * FROM sessions WHERE id = ?');
    const row = stmt.get(id) as any;
    if (!row) return null;
    return this.mapSessionRow(row);
  }

  listSessions(limit = 10, offset = 0): SessionRecord[] {
    const stmt = this.db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ? OFFSET ?');
    const rows = stmt.all(limit, offset) as any[];
    return rows.map(this.mapSessionRow);
  }

  updateSessionTokens(id: string, inputTokens: number, outputTokens: number): void {
    const stmt = this.db.prepare(`
      UPDATE sessions 
      SET total_input_tokens = total_input_tokens + ?,
          total_output_tokens = total_output_tokens + ?,
          updated_at = ?
      WHERE id = ?
    `);
    stmt.run(inputTokens, outputTokens, Date.now(), id);
  }

  // ─── Turns ─────────────────────────────────────────────────────

  saveTurn(sessionId: string, turnIndex: number, messages: Message[], inputTokens: number, outputTokens: number): void {
    const id = randomUUID();
    const now = Date.now();
    const messagesJson = JSON.stringify(messages);

    // Use a transaction to save the turn and update the session's timestamp
    const transaction = this.db.transaction(() => {
      const insertTurn = this.db.prepare(`
        INSERT INTO turns (id, session_id, turn_index, created_at, messages_json, input_tokens, output_tokens)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      insertTurn.run(id, sessionId, turnIndex, now, messagesJson, inputTokens, outputTokens);

      const updateSession = this.db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?');
      updateSession.run(now, sessionId);
    });

    transaction();
  }

  getTurns(sessionId: string): TurnRecord[] {
    const stmt = this.db.prepare('SELECT * FROM turns WHERE session_id = ? ORDER BY turn_index ASC');
    const rows = stmt.all(sessionId) as any[];
    return rows.map(row => ({
      id: row.id,
      sessionId: row.session_id,
      turnIndex: row.turn_index,
      createdAt: row.created_at,
      messages: JSON.parse(row.messages_json),
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens
    }));
  }
  
  /**
   * Reconstruct the full conversation history for a session by concatenating all turns.
   */
  getFullConversation(sessionId: string): Message[] {
    const turns = this.getTurns(sessionId);
    const messages: Message[] = [];
    for (const turn of turns) {
      messages.push(...turn.messages);
    }
    return messages;
  }

  // ─── Helpers ───────────────────────────────────────────────────

  private mapSessionRow(row: any): SessionRecord {
    return {
      id: row.id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      title: row.title,
      projectRoot: row.project_root,
      totalInputTokens: row.total_input_tokens,
      totalOutputTokens: row.total_output_tokens,
      status: row.status
    };
  }
}
