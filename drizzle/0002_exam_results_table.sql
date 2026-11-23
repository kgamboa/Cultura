DROP TABLE IF EXISTS entries;
--> statement-breakpoint
CREATE TABLE exam_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_name TEXT NOT NULL,
  initials TEXT NOT NULL DEFAULT '',
  variant_code TEXT NOT NULL DEFAULT '',
  score REAL NOT NULL,
  total_points REAL NOT NULL,
  percentage REAL NOT NULL,
  theory_score REAL NOT NULL,
  practical_score REAL NOT NULL,
  details TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE roster_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  initials TEXT NOT NULL,
  full_name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
