// Almacén en Postgres (Railway) vía DATABASE_URL.
//
// Los resultados del examen (exam_results) y la lista de alumnos
// (roster_entries) viven en Postgres, NO en el SQLite local (app.db).
// Estos handlers corren en el host (proceso Bun) porque las acciones
// portables no tienen acceso directo a la red ni a variables de entorno:
// leen DATABASE_URL del entorno y hablan con Postgres usando el cliente
// SQL nativo de Bun.
//
// El esquema es el de postgres/0001_initial.sql; los CREATE TABLE IF NOT
// EXISTS de abajo aplican esa misma migración de forma idempotente en el
// primer uso, para que un Postgres recién enlazado en Railway funcione sin
// pasos manuales.

import { SQL } from "bun";
import { definePrivilegedContracts, definePrivilegedHandlers, z } from "@hatch/space-sdk";

export const Pg = definePrivilegedContracts({
  pgSubmitResult: {
    request: z.object({
      studentName: z.string(),
      initials: z.string(),
      variantCode: z.string(),
      score: z.number(),
      totalPoints: z.number(),
      percentage: z.number(),
      theoryScore: z.number(),
      practicalScore: z.number(),
      details: z.string(),
    }),
    response: z.object({ id: z.number() }),
    timeoutMs: 30000,
  },
  pgListResults: {
    request: z.object({ limit: z.number() }),
    response: z.object({
      dbReady: z.boolean(),
      results: z.array(z.object({
        id: z.number(), studentName: z.string(), initials: z.string(), variantCode: z.string(),
        score: z.number(), totalPoints: z.number(), percentage: z.number(),
        theoryScore: z.number(), practicalScore: z.number(), created_at: z.string(),
      })),
    }),
    timeoutMs: 30000,
  },
  pgGetRoster: {
    request: z.object({}),
    response: z.object({
      dbReady: z.boolean(),
      count: z.number(),
      entries: z.array(z.object({ id: z.number(), initials: z.string(), fullName: z.string() })),
    }),
    timeoutMs: 30000,
  },
  pgSaveRoster: {
    request: z.object({
      entries: z.array(z.object({ initials: z.string(), fullName: z.string() })),
    }),
    response: z.object({ count: z.number() }),
    timeoutMs: 30000,
  },
  pgClearRoster: {
    request: z.object({}),
    response: z.object({ ok: z.literal(true) }),
    timeoutMs: 30000,
  },
});

const CREATE_EXAM_RESULTS = `
CREATE TABLE IF NOT EXISTS exam_results (
  id BIGSERIAL PRIMARY KEY,
  student_name TEXT NOT NULL,
  initials TEXT NOT NULL DEFAULT '',
  variant_code TEXT NOT NULL DEFAULT '',
  score DOUBLE PRECISION NOT NULL,
  total_points DOUBLE PRECISION NOT NULL,
  percentage DOUBLE PRECISION NOT NULL,
  theory_score DOUBLE PRECISION NOT NULL,
  practical_score DOUBLE PRECISION NOT NULL,
  details TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`;

const CREATE_ROSTER_ENTRIES = `
CREATE TABLE IF NOT EXISTS roster_entries (
  id BIGSERIAL PRIMARY KEY,
  initials TEXT NOT NULL,
  full_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`;

function connect(): SQL {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL no está configurada: los resultados y la lista de alumnos se guardan en el Postgres de Railway (variable DATABASE_URL).");
  }
  return new SQL(url);
}

async function withPg<T>(fn: (sql: SQL) => Promise<T>): Promise<T> {
  const sql = connect();
  try {
    await sql.unsafe(CREATE_EXAM_RESULTS);
    await sql.unsafe(CREATE_ROSTER_ENTRIES);
    return await fn(sql);
  } finally {
    await sql.close({ timeout: 1 }).catch(() => undefined);
  }
}

type ResultRow = {
  id: number; student_name: string; initials: string; variant_code: string;
  score: number; total_points: number; percentage: number;
  theory_score: number; practical_score: number; created_at: Date | string;
};
type RosterRow = { id: number; initials: string; full_name: string };

export const PgHandlers = definePrivilegedHandlers(Pg, {
  pgSubmitResult: async (args) =>
    withPg(async (sql) => {
      const rows = (await sql`
        INSERT INTO exam_results
          (student_name, initials, variant_code, score, total_points, percentage, theory_score, practical_score, details)
        VALUES
          (${args.studentName}, ${args.initials}, ${args.variantCode}, ${args.score}, ${args.totalPoints}, ${args.percentage}, ${args.theoryScore}, ${args.practicalScore}, ${args.details})
        RETURNING id::int AS id
      `) as unknown as { id: number }[];
      const row = rows[0];
      if (!row) throw new Error("No se pudo guardar el resultado en Postgres");
      return { id: row.id };
    }),

  // Las lecturas degradan con aviso (dbReady: false) cuando DATABASE_URL no
  // está configurada: no hay Postgres del cual leer y NO se cae al SQLite
  // local. Las escrituras, en cambio, fallan en voz alta (ver connect()).
  pgListResults: async (args) => {
    if (!process.env.DATABASE_URL) return { dbReady: false, results: [] };
    return withPg(async (sql) => {
      const rows = (await sql`
        SELECT id::int AS id, student_name, initials, variant_code, score, total_points,
               percentage, theory_score, practical_score, created_at
        FROM exam_results
        ORDER BY id DESC
        LIMIT ${args.limit}
      `) as unknown as ResultRow[];
      return {
        dbReady: true,
        results: rows.map((r) => ({
          id: r.id, studentName: r.student_name, initials: r.initials, variantCode: r.variant_code,
          score: r.score, totalPoints: r.total_points, percentage: r.percentage,
          theoryScore: r.theory_score, practicalScore: r.practical_score,
          created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
        })),
      };
    });
  },

  pgGetRoster: async () => {
    if (!process.env.DATABASE_URL) return { dbReady: false, count: 0, entries: [] };
    return withPg(async (sql) => {
      const rows = (await sql`
        SELECT id::int AS id, initials, full_name
        FROM roster_entries
        ORDER BY id ASC
      `) as unknown as RosterRow[];
      return { dbReady: true, count: rows.length, entries: rows.map((r) => ({ id: r.id, initials: r.initials, fullName: r.full_name })) };
    });
  },

  pgSaveRoster: async (args) =>
    withPg(async (sql) => {
      await sql.begin(async (tx) => {
        await tx`DELETE FROM roster_entries`;
        for (const e of args.entries) {
          await tx`INSERT INTO roster_entries (initials, full_name) VALUES (${e.initials}, ${e.fullName})`;
        }
      });
      return { count: args.entries.length };
    }),

  pgClearRoster: async () =>
    withPg(async (sql) => {
      await sql`DELETE FROM roster_entries`;
      return { ok: true as const };
    }),
});
