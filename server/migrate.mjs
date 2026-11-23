// Migración automática al arrancar el contenedor de Railway.
//
// Se ejecuta desde el CMD del Dockerfile ANTES de levantar el servidor:
// lee DATABASE_URL, abre el Postgres y aplica postgres/0001_initial.sql
// completo (todos los CREATE TABLE IF NOT EXISTS), para que la base nunca
// arranque vacía por falta de un paso manual. Es idempotente: correrla en
// cada despliegue no borra ni duplica nada.
//
// SOLO crea tablas. No carga ningún dato: la lista de alumnos NO va en el
// repo (es público y trae nombres de alumnos); se carga una sola vez desde
// el panel del maestro después del despliegue.
//
// Si DATABASE_URL no está configurada, avisa y sale con código 0 para no
// tumbar el servidor web: el examen igual se sirve, y los handlers de la
// app vuelven a intentar crear las tablas en el primer uso.
import { SQL } from "bun";
import { readFile } from "node:fs/promises";

const url = process.env.DATABASE_URL;
if (!url) {
  console.warn("[migrate] DATABASE_URL no está configurada: no hay Postgres que migrar. El servidor web arranca igual; sin base no se guardan resultados ni lista.");
  process.exit(0);
}

const raw = await readFile(new URL("../postgres/0001_initial.sql", import.meta.url), "utf8");
// Quita comentarios de línea y parte el archivo en sentencias individuales.
const statements = raw
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

const MAX_ATTEMPTS = 10;
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  const sql = new SQL(url);
  try {
    for (const stmt of statements) await sql.unsafe(stmt);
    const rows = await sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
    console.log(`[migrate] Migración aplicada (intento ${attempt}). Tablas en Postgres: ${rows.map((r) => r.tablename).join(", ") || "(ninguna)"}.`);
    await sql.close({ timeout: 1 }).catch(() => undefined);
    process.exit(0);
  } catch (err) {
    await sql.close({ timeout: 1 }).catch(() => undefined);
    console.warn(`[migrate] Intento ${attempt}/${MAX_ATTEMPTS} falló: ${err instanceof Error ? err.message : String(err)}`);
    if (attempt === MAX_ATTEMPTS) {
      console.warn("[migrate] No se pudo migrar al arrancar; el servidor web arranca igual y los handlers crean las tablas en el primer uso.");
      process.exit(0);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}
