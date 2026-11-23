import { defineAction, z, type ActionsModule } from "@hatch/space-sdk";
import { Pg } from "@space/privileged";

// Todas las acciones leen y escriben en Postgres (Railway) usando la
// variable de entorno DATABASE_URL, a través de los handlers privilegiados
// de server/src/privileged.ts. El SQLite local (app.db) ya no es el almacén
// de resultados ni de la lista de alumnos.
//
// Panel del maestro protegido: la lista completa y los resultados exigen la
// contraseña del maestro. La contraseña se define una sola vez (primera vez
// que se abre el panel) y aquí solo viaja su hash SHA-256: el servidor
// (Postgres) guarda ese hash y lo compara en cada desbloqueo y en cada
// lectura/escritura del panel. Nunca se guarda ni se compara solo en el
// cliente. El flujo del alumno no pide contraseña.

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const passwordField = z.string().min(4, "La contraseña debe tener al menos 4 caracteres.").max(100);

export const Actions = {
  submitResult: defineAction({
    description: "Guarda el resultado de un examen terminado con iniciales, variante y desglose.",
    request: z.object({
      studentName: z.string().trim().min(1).max(80),
      initials: z.string().trim().min(2).max(12),
      variantCode: z.string().trim().min(1).max(20),
      score: z.number().min(0).max(200),
      totalPoints: z.number().min(1).max(200),
      percentage: z.number().min(0).max(100),
      theoryScore: z.number().min(0).max(200),
      practicalScore: z.number().min(0).max(100),
      details: z.string().max(12000),
    }),
    response: z.object({ id: z.number() }),
    privileged: [Pg.pgSubmitResult],
    async handler(ctx, args) {
      const result = await ctx.executePrivileged(Pg.pgSubmitResult, {
        studentName: args.studentName,
        initials: args.initials.toUpperCase(),
        variantCode: args.variantCode,
        score: args.score,
        totalPoints: args.totalPoints,
        percentage: args.percentage,
        theoryScore: args.theoryScore,
        practicalScore: args.practicalScore,
        details: args.details,
      });
      ctx.invalidateQueries();
      return result;
    },
  }),

  teacherStatus: defineAction({
    description: "Dice si el panel del maestro ya tiene contraseña definida en el servidor (Postgres).",
    request: z.object({}),
    response: z.object({ dbReady: z.boolean(), hasPassword: z.boolean() }),
    privileged: [Pg.pgTeacherStatus],
    async handler(ctx) {
      return await ctx.executePrivileged(Pg.pgTeacherStatus, {});
    },
  }),

  setTeacherPassword: defineAction({
    description: "Define la contraseña del maestro por primera vez; el servidor guarda solo su hash en Postgres. Falla si ya hay una definida.",
    request: z.object({ password: passwordField }),
    response: z.object({ ok: z.literal(true) }),
    privileged: [Pg.pgSetTeacherPassword],
    async handler(ctx, args): Promise<{ ok: true }> {
      const result = await ctx.executePrivileged(Pg.pgSetTeacherPassword, {
        passwordHash: await sha256Hex(args.password),
      });
      ctx.invalidateQueries();
      return result;
    },
  }),

  verifyTeacherPassword: defineAction({
    description: "Verifica en el servidor si la contraseña escrita coincide con la del maestro guardada en Postgres.",
    request: z.object({ password: z.string().min(1).max(100) }),
    response: z.object({ dbReady: z.boolean(), ok: z.boolean() }),
    privileged: [Pg.pgVerifyTeacherPassword],
    async handler(ctx, args) {
      return await ctx.executePrivileged(Pg.pgVerifyTeacherPassword, {
        passwordHash: await sha256Hex(args.password),
      });
    },
  }),

  lookupStudent: defineAction({
    description: "Busca el nombre de un alumno por sus iniciales en la lista cargada, para identificarlo al entrar al examen. No expone la lista completa.",
    request: z.object({ initials: z.string().trim().max(12).default("") }),
    response: z.object({ dbReady: z.boolean(), count: z.number(), fullName: z.string().nullable() }),
    privileged: [Pg.pgLookupStudent],
    async handler(ctx, args) {
      return await ctx.executePrivileged(Pg.pgLookupStudent, {
        initials: args.initials.toUpperCase().replace(/\s+/g, ""),
      });
    },
  }),

  listResults: defineAction({
    description: "Lista los resultados de exámenes más recientes para el docente. Exige la contraseña del maestro, verificada en el servidor.",
    request: z.object({
      limit: z.number().int().positive().max(100).default(100),
      password: passwordField,
    }),
    response: z.object({
      dbReady: z.boolean(),
      results: z.array(z.object({
        id: z.number(), studentName: z.string(), initials: z.string(), variantCode: z.string(),
        score: z.number(), totalPoints: z.number(), percentage: z.number(),
        theoryScore: z.number(), practicalScore: z.number(), created_at: z.string(),
      })),
    }),
    privileged: [Pg.pgListResults],
    async handler(ctx, args) {
      return await ctx.executePrivileged(Pg.pgListResults, {
        limit: args.limit,
        passwordHash: await sha256Hex(args.password),
      });
    },
  }),

  getRoster: defineAction({
    description: "Obtiene la lista completa de alumnos cargada por el maestro. Exige la contraseña del maestro, verificada en el servidor.",
    request: z.object({ password: passwordField }),
    response: z.object({
      dbReady: z.boolean(),
      count: z.number(),
      entries: z.array(z.object({ id: z.number(), initials: z.string(), fullName: z.string() })),
    }),
    privileged: [Pg.pgGetRoster],
    async handler(ctx, args) {
      return await ctx.executePrivileged(Pg.pgGetRoster, {
        passwordHash: await sha256Hex(args.password),
      });
    },
  }),

  saveRoster: defineAction({
    description: "Reemplaza la lista de alumnos del maestro. Exige la contraseña del maestro, verificada en el servidor.",
    request: z.object({
      password: passwordField,
      entries: z.array(z.object({
        initials: z.string().trim().min(2).max(12),
        fullName: z.string().trim().max(120).default(""),
      })).max(200),
    }),
    response: z.object({ count: z.number() }),
    privileged: [Pg.pgSaveRoster],
    async handler(ctx, args) {
      // Dedupe by initials uppercase
      const seen = new Set<string>();
      const clean: { initials: string; fullName: string }[] = [];
      for (const e of args.entries) {
        const ini = e.initials.toUpperCase().replace(/\s+/g, "");
        if (seen.has(ini)) continue;
        seen.add(ini);
        clean.push({ initials: ini, fullName: e.fullName });
      }
      const result = await ctx.executePrivileged(Pg.pgSaveRoster, {
        passwordHash: await sha256Hex(args.password),
        entries: clean,
      });
      ctx.invalidateQueries();
      return result;
    },
  }),

  clearRoster: defineAction({
    description: "Borra la lista de alumnos cargada. Exige la contraseña del maestro, verificada en el servidor.",
    request: z.object({ password: passwordField }),
    response: z.object({ ok: z.literal(true) }),
    privileged: [Pg.pgClearRoster],
    async handler(ctx, args): Promise<{ ok: true }> {
      const result = await ctx.executePrivileged(Pg.pgClearRoster, {
        passwordHash: await sha256Hex(args.password),
      });
      ctx.invalidateQueries();
      return result;
    },
  }),
} satisfies ActionsModule;
