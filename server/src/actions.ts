import { defineAction, z, type ActionsModule } from "@hatch/space-sdk";
import { Pg } from "@space/privileged";

// Todas las acciones leen y escriben en Postgres (Railway) usando la
// variable de entorno DATABASE_URL, a través de los handlers privilegiados
// de server/src/privileged.ts. El SQLite local (app.db) ya no es el almacén
// de resultados ni de la lista de alumnos.

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

  listResults: defineAction({
    description: "Lista los resultados de exámenes más recientes para el docente.",
    request: z.object({ limit: z.number().int().positive().max(100).default(100) }),
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
      return await ctx.executePrivileged(Pg.pgListResults, { limit: args.limit });
    },
  }),

  getRoster: defineAction({
    description: "Obtiene la lista de alumnos cargada por el maestro. Si está vacía, el examen acepta cualquier iniciales.",
    request: z.object({}),
    response: z.object({
      dbReady: z.boolean(),
      count: z.number(),
      entries: z.array(z.object({ id: z.number(), initials: z.string(), fullName: z.string() })),
    }),
    privileged: [Pg.pgGetRoster],
    async handler(ctx) {
      return await ctx.executePrivileged(Pg.pgGetRoster, {});
    },
  }),

  saveRoster: defineAction({
    description: "Reemplaza la lista de alumnos del maestro. Cada entrada trae iniciales y nombre completo opcional.",
    request: z.object({
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
      const result = await ctx.executePrivileged(Pg.pgSaveRoster, { entries: clean });
      ctx.invalidateQueries();
      return result;
    },
  }),

  clearRoster: defineAction({
    description: "Borra la lista de alumnos cargada, volviendo al modo libre de iniciales.",
    request: z.object({}),
    response: z.object({ ok: z.literal(true) }),
    privileged: [Pg.pgClearRoster],
    async handler(ctx): Promise<{ ok: true }> {
      const result = await ctx.executePrivileged(Pg.pgClearRoster, {});
      ctx.invalidateQueries();
      return result;
    },
  }),
} satisfies ActionsModule;
