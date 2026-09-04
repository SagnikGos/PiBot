// ─── Session Repository Tests ────────────────────────────────────
// Tests for SQLite-based session persistence.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDatabase } from '../../src/storage/db.js';
import { SessionRepository } from '../../src/storage/session-repo.js';
import type { Database } from 'better-sqlite3';
import { join } from 'path';
import { tmpdir } from 'os';
import { rmSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';

describe('SessionRepository', () => {
  let db: Database;
  let repo: SessionRepository;
  const testDir = join(tmpdir(), 'pibot-tests-' + randomUUID());
  const dbPath = join(testDir, 'test.db');

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    db = getDatabase({ dbPath });
    repo = new SessionRepository(db);
  });

  afterEach(() => {
    db.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should create and retrieve a session', () => {
    const session = repo.createSession('/foo/bar');
    expect(session.projectRoot).toBe('/foo/bar');
    expect(session.status).toBe('active');
    expect(session.totalInputTokens).toBe(0);

    const retrieved = repo.getSession(session.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe(session.id);
  });

  it('should list sessions', async () => {
    repo.createSession('/project1');
    // Ensure slight time difference for sorting
    await new Promise((resolve) => setTimeout(resolve, 10));
    const s2 = repo.createSession('/project2');

    const sessions = repo.listSessions();
    expect(sessions).toHaveLength(2);
    // Ordered by updated_at DESC, so most recent is first
    expect(sessions[0].id).toBe(s2.id);
  });

  it('should update session tokens', () => {
    const session = repo.createSession('/project');
    repo.updateSessionTokens(session.id, 100, 50);

    const updated = repo.getSession(session.id);
    expect(updated!.totalInputTokens).toBe(100);
    expect(updated!.totalOutputTokens).toBe(50);
  });

  it('should save and retrieve turns', () => {
    const session = repo.createSession('/project');
    
    repo.saveTurn(
      session.id,
      0,
      [{ role: 'user', content: 'test msg' }],
      10,
      20
    );

    const turns = repo.getTurns(session.id);
    expect(turns).toHaveLength(1);
    expect(turns[0].turnIndex).toBe(0);
    expect(turns[0].inputTokens).toBe(10);
    expect(turns[0].messages[0]).toEqual({ role: 'user', content: 'test msg' });
  });

  it('should reconstruct full conversation history', () => {
    const session = repo.createSession('/project');
    
    repo.saveTurn(
      session.id,
      0,
      [{ role: 'user', content: 'msg 1' }],
      10,
      10
    );
    repo.saveTurn(
      session.id,
      1,
      [{ role: 'assistant', content: 'response 1' }, { role: 'user', content: 'msg 2' }],
      20,
      20
    );

    const fullHistory = repo.getFullConversation(session.id);
    expect(fullHistory).toHaveLength(3);
    expect(fullHistory[0].content).toBe('msg 1');
    expect(fullHistory[1].content).toBe('response 1');
    expect(fullHistory[2].content).toBe('msg 2');
  });
});
