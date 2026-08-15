import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { RoomMode } from "../shared/game-types";

export interface MatchRecord {
  id: string;
  roomId: string;
  mode: RoomMode;
  startedAt: number;
  endedAt: number;
  rounds: number;
  summary: unknown;
}

export interface MatchStore {
  save(record: MatchRecord): void;
  count(): number;
  close(): void;
}

/**
 * 개발·소규모 실행용 SQLite 저장소다.
 * 운영 확장 시 같은 인터페이스를 PostgreSQL 구현으로 교체한다.
 */
export class SqliteMatchStore implements MatchStore {
  private readonly database: DatabaseSync;

  constructor(databasePath = resolve(process.cwd(), "data", "nunchisoom.sqlite")) {
    if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA journal_mode = WAL");
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS matches (
        id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER NOT NULL,
        rounds INTEGER NOT NULL,
        summary_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    this.database.exec("CREATE INDEX IF NOT EXISTS idx_matches_room_started ON matches(room_id, started_at)");
    this.database.exec("PRAGMA optimize");
  }

  save(record: MatchRecord): void {
    this.database
      .prepare(`
        INSERT OR REPLACE INTO matches
          (id, room_id, mode, started_at, ended_at, rounds, summary_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        record.id,
        record.roomId,
        record.mode,
        record.startedAt,
        record.endedAt,
        record.rounds,
        JSON.stringify(record.summary),
      );
  }

  count(): number {
    const row = this.database.prepare("SELECT COUNT(*) AS count FROM matches").get() as { count: number };
    return Number(row.count);
  }

  close(): void {
    this.database.close();
  }
}
