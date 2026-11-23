-- Examen de Excel — esquema en Postgres (Railway)
--
-- Almacén oficial de la app: la variable DATABASE_URL apunta a este
-- Postgres. El SQLite local (app.db) ya NO guarda resultados ni la lista
-- de alumnos.
--
-- Aplica esta migración una vez en el Postgres de Railway, por ejemplo:
--   psql "$DATABASE_URL" -f postgres/0001_initial.sql
-- Los handlers de la app ejecutan además estos mismos CREATE TABLE IF NOT
-- EXISTS al primer uso, así que la migración es idempotente y segura de
-- re-correr.

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
);

CREATE TABLE IF NOT EXISTS roster_entries (
  id BIGSERIAL PRIMARY KEY,
  initials TEXT NOT NULL,
  full_name TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ajustes de la app. Aquí vive la contraseña del maestro: la fila con
-- key = 'teacher_password_hash' guarda SOLO el hash SHA-256 de la
-- contraseña (nunca la contraseña en claro). La define el maestro la
-- primera vez que abre el panel; para cambiarla, borra esa fila y el
-- panel pedirá definir una nueva.
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
