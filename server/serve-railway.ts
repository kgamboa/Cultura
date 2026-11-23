// Servidor real del Examen de Excel para el despliegue en Railway.
//
// ANTES: el Dockerfile servía solo los archivos estáticos de client/dist y
// devolvía index.html para TODA ruta. El cliente llama a las acciones con
// POST /actions y recibía ese HTML con estado 200: la llamada "funcionaba"
// en los logs pero ninguna acción se ejecutaba. Por eso en Railway el panel
// del maestro se abría sin pedir contraseña (teacherStatus nunca respondía
// y la interfaz solo mostraba la tarjeta informativa de Railway) y el
// avance del examen nunca se guardaba (exam_progress quedaba vacía).
//
// ESTE servidor hace las dos cosas:
//   1. Sirve los archivos estáticos de client/dist (con respaldo a
//      index.html para las rutas de la app).
//   2. Atiende POST /actions con el mismo protocolo que usa el cliente del
//      SDK (@hatch/space-sdk/client): recibe { action, args } en JSON,
//      valida los argumentos con el esquema de la acción, ejecuta el
//      handler de server/src/actions.ts conectando ctx.executePrivileged
//      directamente con los handlers de server/src/privileged.ts (los que
//      hablan con Postgres vía DATABASE_URL) y responde { data } en JSON.
//      Los errores viajan como { error } con estado 4xx/5xx, igual que en
//      el runtime de Muse, para que el cliente los muestre tal cual.
//
// Solo lo usa el contenedor de Railway (ver Dockerfile: se compila con
// `bun build` a server/dist-railway/serve.js). Dentro de Muse manda el
// runtime normal del artefacto y este archivo no interviene.

import { createPrivilegedExecutor, isAction, type ActionDefinition, type Ctx, type PrivilegedTransport } from "@hatch/space-sdk";
import { Actions } from "./src/actions";
import { PgHandlers } from "./src/privileged";

// --- Despacho de handlers privilegiados -------------------------------------
// En Muse, ctx.executePrivileged cruza al proceso anfitrión; aquí las
// acciones y los handlers corren en el mismo proceso Bun, así que el
// "transporte" es una simple búsqueda por nombre de contrato.
const handlerByName = new Map(PgHandlers.entries.map((entry) => [entry.contract.name, entry.handler]));
const transport: PrivilegedTransport = async (contract, args) => {
  const handler = handlerByName.get(contract.name);
  if (!handler) {
    throw new Error(`El servidor de Railway no tiene handler privilegiado para "${contract.name}".`);
  }
  return await handler(args as never);
};

// --- Tabla de acciones -------------------------------------------------------
const actionByName = new Map<string, ActionDefinition>();
for (const [name, value] of Object.entries(Actions)) {
  if (isAction(value)) actionByName.set(name, value);
}

// Las acciones de este examen solo usan ctx.executePrivileged y
// ctx.invalidateQueries; el resto del Ctx (db local, blobs, modelo) no
// existe en Railway y falla en voz alta si algo lo tocara por error.
function unavailable(what: string): never {
  throw new Error(`${what} no está disponible en el servidor de Railway: esta app guarda todo en Postgres vía las acciones privilegiadas.`);
}
function makeCtx(action: ActionDefinition): Ctx {
  const executor = createPrivilegedExecutor(action.privileged, transport);
  const base = {
    slug: "examen-de-excel",
    invocationId: `railway-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    spaceDir: process.cwd(),
    executePrivileged: executor.executePrivileged,
    invalidateQueries: () => undefined,
    emit: () => undefined,
  };
  return new Proxy(base, {
    get(target, prop) {
      if (prop in target) return (target as Record<string | symbol, unknown>)[prop];
      if (prop === "db" || prop === "blobs" || prop === "agent" || prop === "inference" || prop === "tool" || prop === "viewer") {
        unavailable(`ctx.${String(prop)}`);
      }
      return undefined;
    },
  }) as unknown as Ctx;
}

// --- Protocolo POST /actions (el mismo que espera el cliente del SDK) -------
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function handleAction(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "El cuerpo de la petición no es JSON válido." }, 400);
  }
  const actionName = (body as { action?: unknown } | null)?.action;
  const rawArgs = (body as { args?: unknown } | null)?.args ?? {};
  if (typeof actionName !== "string" || !actionName) {
    return jsonResponse({ error: "Falta el nombre de la acción en la petición." }, 400);
  }
  const action = actionByName.get(actionName);
  if (!action) {
    return jsonResponse({ error: `Acción desconocida: ${actionName}` }, 404);
  }
  const parsedArgs = action.request.safeParse(rawArgs);
  if (!parsedArgs.success) {
    // Mismo formato que el runtime de Muse: el cliente extrae de aquí los
    // mensajes por campo para mostrarlos junto al formulario.
    return jsonResponse({ error: `invalid args: ${JSON.stringify(parsedArgs.error.issues)}` }, 400);
  }
  try {
    const result = await action.handler(makeCtx(action), parsedArgs.data);
    const parsedResult = action.response.safeParse(result);
    if (!parsedResult.success) {
      console.error(`[actions] ${actionName}: la respuesta no pasó su esquema: ${parsedResult.error.message}`);
      return jsonResponse({ error: `response validation failed: ${parsedResult.error.message}` }, 500);
    }
    return jsonResponse({ data: parsedResult.data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[actions] ${actionName}: ${message}`);
    return jsonResponse({ error: message }, 500);
  }
}

// --- Servidor HTTP: estáticos + /actions ------------------------------------
const DIST_DIR = "./client/dist";
const port = Number.parseInt(process.env.PORT ?? "", 10) || 8080;

const server = Bun.serve({
  port,
  hostname: "0.0.0.0",
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/actions") {
      if (req.method !== "POST") {
        return jsonResponse({ error: "Las acciones solo aceptan POST." }, 405);
      }
      return handleAction(req);
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      return jsonResponse({ error: "Método no permitido." }, 405);
    }
    const path = url.pathname === "/" ? "/index.html" : url.pathname;
    const direct = Bun.file(`${DIST_DIR}${path}`);
    const isDirect = await direct.exists();
    // Ruta de la app (SPA) sin archivo propio: se sirve el index y el
    // cliente decide la vista. El index nunca se cachea, para que un
    // redespliegue se vea de inmediato.
    const file = isDirect ? direct : Bun.file(`${DIST_DIR}/index.html`);
    const headers: Record<string, string> = {};
    if (!isDirect || path === "/index.html") headers["cache-control"] = "no-cache";
    return new Response(req.method === "HEAD" ? null : file, { headers });
  },
});

console.log(
  `[railway] Examen de Excel escuchando en el puerto ${server.port} · ` +
    `${actionByName.size} acciones listas en POST /actions · ` +
    (process.env.DATABASE_URL
      ? "DATABASE_URL configurada (Postgres es el almacén)."
      : "SIN DATABASE_URL: el examen se sirve, pero no se guardan resultados, lista ni avance."),
);
