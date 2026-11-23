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
    request: z.object({ limit: z.number(), passwordHash: z.string() }),
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
    request: z.object({ passwordHash: z.string() }),
    response: z.object({
      dbReady: z.boolean(),
      count: z.number(),
      entries: z.array(z.object({ id: z.number(), initials: z.string(), fullName: z.string() })),
    }),
    timeoutMs: 30000,
  },
  pgSaveRoster: {
    request: z.object({
      passwordHash: z.string(),
      entries: z.array(z.object({ initials: z.string(), fullName: z.string() })),
    }),
    response: z.object({ count: z.number() }),
    timeoutMs: 30000,
  },
  pgClearRoster: {
    request: z.object({ passwordHash: z.string() }),
    response: z.object({ ok: z.literal(true) }),
    timeoutMs: 30000,
  },
  // Contraseña del panel del maestro: se guarda SOLO su hash SHA-256 en
  // Postgres (tabla app_settings). Las acciones hashean la contraseña
  // escrita antes de llamarnos; aquí nunca llega ni se guarda en claro.
  pgTeacherStatus: {
    request: z.object({}),
    response: z.object({ dbReady: z.boolean(), hasPassword: z.boolean() }),
    timeoutMs: 30000,
  },
  pgSetTeacherPassword: {
    request: z.object({ passwordHash: z.string() }),
    response: z.object({ ok: z.literal(true) }),
    timeoutMs: 30000,
  },
  pgVerifyTeacherPassword: {
    request: z.object({ passwordHash: z.string() }),
    response: z.object({ dbReady: z.boolean(), ok: z.boolean() }),
    timeoutMs: 30000,
  },
  // Búsqueda pública y mínima para el flujo del alumno: con unas iniciales
  // devuelve solo el nombre que les corresponde en la lista (para
  // identificarlo al entrar) y cuántos alumnos hay cargados. La lista
  // completa y los resultados exigen la contraseña del maestro.
  pgLookupStudent: {
    request: z.object({ initials: z.string() }),
    response: z.object({ dbReady: z.boolean(), count: z.number(), fullName: z.string().nullable() }),
    timeoutMs: 30000,
  },
  // Bloqueo de reingreso: con unas iniciales devuelve el resultado ya
  // enviado más reciente (si existe), para que el alumno no pueda repetir
  // la misma variante. Solo expone nombre y calificación de ESE alumno.
  pgFindResultByInitials: {
    request: z.object({ initials: z.string() }),
    response: z.object({
      dbReady: z.boolean(),
      result: z.object({
        studentName: z.string(), variantCode: z.string(), score: z.number(),
        totalPoints: z.number(), percentage: z.number(), created_at: z.string(),
      }).nullable(),
    }),
    timeoutMs: 30000,
  },
  // Borrado de un resultado desde el panel del maestro (con su contraseña):
  // permite que ese alumno vuelva a hacer el examen.
  pgDeleteResult: {
    request: z.object({ passwordHash: z.string(), id: z.number() }),
    response: z.object({ ok: z.literal(true) }),
    timeoutMs: 30000,
  },
  // Avance en curso del alumno (respuestas, fórmulas y celda actual, como
  // JSON en `state`), guardado por iniciales mientras el examen no se ha
  // enviado. Al enviar el examen, pgSubmitResult borra este avance.
  pgSaveProgress: {
    request: z.object({ initials: z.string(), studentName: z.string(), variantCode: z.string(), state: z.string() }),
    response: z.object({ ok: z.literal(true) }),
    timeoutMs: 30000,
  },
  pgGetProgress: {
    request: z.object({ initials: z.string() }),
    response: z.object({
      dbReady: z.boolean(),
      progress: z.object({ studentName: z.string(), variantCode: z.string(), state: z.string() }).nullable(),
    }),
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

const CREATE_EXAM_PROGRESS = `
CREATE TABLE IF NOT EXISTS exam_progress (
  initials TEXT PRIMARY KEY,
  student_name TEXT NOT NULL DEFAULT '',
  variant_code TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`;

const CREATE_APP_SETTINGS = `
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)`;

const TEACHER_PASSWORD_KEY = "teacher_password_hash";

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
    await sql.unsafe(CREATE_APP_SETTINGS);
    await sql.unsafe(CREATE_EXAM_PROGRESS);
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

// Puerta del panel del maestro: sin contraseña definida no se entrega ni se
// modifica nada de la lista ni de los resultados, y con una contraseña
// distinta a la guardada tampoco. La comparación ocurre aquí, en el
// servidor, contra el hash almacenado en Postgres.
async function requireTeacher(sql: SQL, passwordHash: string): Promise<void> {
  const rows = (await sql`
    SELECT value FROM app_settings WHERE key = ${TEACHER_PASSWORD_KEY}
  `) as unknown as { value: string }[];
  const stored = rows[0]?.value;
  if (!stored) {
    throw new Error("El panel del maestro todavía no tiene contraseña: defínela primero para ver la lista de alumnos y los resultados.");
  }
  if (stored !== passwordHash) {
    throw new Error("Contraseña del maestro incorrecta.");
  }
}

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
      // El examen ya se envió: el avance en curso se borra, queda el resultado.
      await sql`DELETE FROM exam_progress WHERE initials = ${args.initials}`;
      return { id: row.id };
    }),

  // Las lecturas degradan con aviso (dbReady: false) cuando DATABASE_URL no
  // está configurada: no hay Postgres del cual leer y NO se cae al SQLite
  // local. Las escrituras, en cambio, fallan en voz alta (ver connect()).
  pgListResults: async (args) => {
    if (!process.env.DATABASE_URL) return { dbReady: false, results: [] };
    return withPg(async (sql) => {
      await requireTeacher(sql, args.passwordHash);
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

  pgGetRoster: async (args) => {
    if (!process.env.DATABASE_URL) return { dbReady: false, count: 0, entries: [] };
    return withPg(async (sql) => {
      await requireTeacher(sql, args.passwordHash);
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
      await requireTeacher(sql, args.passwordHash);
      await sql.begin(async (tx) => {
        await tx`DELETE FROM roster_entries`;
        for (const e of args.entries) {
          await tx`INSERT INTO roster_entries (initials, full_name) VALUES (${e.initials}, ${e.fullName})`;
        }
      });
      return { count: args.entries.length };
    }),

  pgClearRoster: async (args) =>
    withPg(async (sql) => {
      await requireTeacher(sql, args.passwordHash);
      await sql`DELETE FROM roster_entries`;
      return { ok: true as const };
    }),

  pgTeacherStatus: async () => {
    if (!process.env.DATABASE_URL) return { dbReady: false, hasPassword: false };
    return withPg(async (sql) => {
      const rows = (await sql`
        SELECT value FROM app_settings WHERE key = ${TEACHER_PASSWORD_KEY}
      `) as unknown as { value: string }[];
      return { dbReady: true, hasPassword: Boolean(rows[0]?.value) };
    });
  },

  pgSetTeacherPassword: async (args) =>
    withPg(async (sql) => {
      const rows = (await sql`
        SELECT value FROM app_settings WHERE key = ${TEACHER_PASSWORD_KEY}
      `) as unknown as { value: string }[];
      if (rows[0]?.value) {
        throw new Error("Ya hay una contraseña del maestro definida. Para cambiarla, borra la fila 'teacher_password_hash' de la tabla app_settings en Postgres y define una nueva.");
      }
      await sql`
        INSERT INTO app_settings (key, value) VALUES (${TEACHER_PASSWORD_KEY}, ${args.passwordHash})
      `;
      return { ok: true as const };
    }),

  pgVerifyTeacherPassword: async (args) => {
    if (!process.env.DATABASE_URL) return { dbReady: false, ok: false };
    return withPg(async (sql) => {
      const rows = (await sql`
        SELECT value FROM app_settings WHERE key = ${TEACHER_PASSWORD_KEY}
      `) as unknown as { value: string }[];
      const stored = rows[0]?.value;
      return { dbReady: true, ok: Boolean(stored) && stored === args.passwordHash };
    });
  },

  pgLookupStudent: async (args) => {
    if (!process.env.DATABASE_URL) return { dbReady: false, count: 0, fullName: null };
    return withPg(async (sql) => {
      const countRows = (await sql`SELECT COUNT(*)::int AS n FROM roster_entries`) as unknown as { n: number }[];
      let fullName: string | null = null;
      if (args.initials) {
        const rows = (await sql`
          SELECT full_name FROM roster_entries WHERE initials = ${args.initials} LIMIT 1
        `) as unknown as { full_name: string }[];
        fullName = rows[0]?.full_name || null;
      }
      return { dbReady: true, count: countRows[0]?.n ?? 0, fullName };
    });
  },

  pgFindResultByInitials: async (args) => {
    if (!process.env.DATABASE_URL) return { dbReady: false, result: null };
    return withPg(async (sql) => {
      const rows = (await sql`
        SELECT student_name, variant_code, score, total_points, percentage, created_at
        FROM exam_results
        WHERE initials = ${args.initials}
        ORDER BY id DESC
        LIMIT 1
      `) as unknown as { student_name: string; variant_code: string; score: number; total_points: number; percentage: number; created_at: Date | string }[];
      const r = rows[0];
      if (!r) return { dbReady: true, result: null };
      return {
        dbReady: true,
        result: {
          studentName: r.student_name, variantCode: r.variant_code, score: r.score,
          totalPoints: r.total_points, percentage: r.percentage,
          created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
        },
      };
    });
  },

  pgDeleteResult: async (args) =>
    withPg(async (sql) => {
      await requireTeacher(sql, args.passwordHash);
      await sql`DELETE FROM exam_results WHERE id = ${args.id}`;
      return { ok: true as const };
    }),

  pgSaveProgress: async (args) =>
    withPg(async (sql) => {
      await sql`
        INSERT INTO exam_progress (initials, student_name, variant_code, state, updated_at)
        VALUES (${args.initials}, ${args.studentName}, ${args.variantCode}, ${args.state}, now())
        ON CONFLICT (initials) DO UPDATE SET
          student_name = EXCLUDED.student_name,
          variant_code = EXCLUDED.variant_code,
          state = EXCLUDED.state,
          updated_at = now()
      `;
      return { ok: true as const };
    }),

  pgGetProgress: async (args) => {
    if (!process.env.DATABASE_URL) return { dbReady: false, progress: null };
    return withPg(async (sql) => {
      const rows = (await sql`
        SELECT student_name, variant_code, state FROM exam_progress WHERE initials = ${args.initials} LIMIT 1
      `) as unknown as { student_name: string; variant_code: string; state: string }[];
      const r = rows[0];
      if (!r) return { dbReady: true, progress: null };
      return { dbReady: true, progress: { studentName: r.student_name, variantCode: r.variant_code, state: r.state } };
    });
  },
});
