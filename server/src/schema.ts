// LEGADO: este esquema SQLite ya no lo usa ninguna acción. El almacén
// oficial de resultados y de la lista de alumnos es Postgres (DATABASE_URL);
// ver server/src/privileged.ts y postgres/0001_initial.sql. Se conserva solo
// porque las migraciones drizzle/ ya aplicadas lo referencian.
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const examResults = sqliteTable("exam_results", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  studentName: text("student_name").notNull(),
  initials: text("initials").notNull().default(""),
  variantCode: text("variant_code").notNull().default(""),
  score: real("score").notNull(),
  totalPoints: real("total_points").notNull(),
  percentage: real("percentage").notNull(),
  theoryScore: real("theory_score").notNull(),
  practicalScore: real("practical_score").notNull(),
  details: text("details").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const rosterEntries = sqliteTable("roster_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  initials: text("initials").notNull(),
  fullName: text("full_name").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});
