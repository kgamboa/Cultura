# Publicar el Examen de Excel en Railway

Guía rápida para el maestro. La versión que vive dentro de Muse ya funciona y guarda resultados; estos archivos preparan el mismo proyecto para publicarlo también en Railway.

## Archivos incluidos

| Archivo | Para qué sirve |
|---|---|
| `railway.json` | Le dice a Railway que construya con el `Dockerfile` y reinicie el servicio si falla. |
| `Dockerfile` | Construye el cliente con Bun y lo sirve en el puerto `$PORT` que asigna Railway. |
| `.env.example` | Plantilla de variables de entorno documentadas (no subas un `.env` real con claves). |

## Pasos

1. Sube esta carpeta a un repositorio de GitHub (sin `node_modules` ni `app.db`).
2. En [railway.com](https://railway.com): **New Project → Deploy from GitHub repo** y elige el repositorio.
3. Railway detecta `railway.json` y el `Dockerfile` automáticamente. No necesitas comando de inicio: el contenedor ya lo trae.
4. Enlaza un servicio **Postgres** al proyecto y verifica en **Variables**:
   - `PORT`: lo inyecta Railway, no lo escribas.
   - `NODE_ENV=production`.
   - `DATABASE_URL`: la crea Railway al enlazar el Postgres. Es **requerida**: ahí se guardan los resultados (`exam_results`) y la lista de alumnos (`roster_entries`). El SQLite local ya no es el almacén.
   - `TEACHER_PIN`: opcional, para proteger el panel del maestro en un despliegue público.
5. (Opcional) Aplica la migración del esquema: `psql "$DATABASE_URL" -f postgres/0001_initial.sql`. Si no la corres, la app crea las tablas automáticamente en el primer uso.
6. En **Settings → Networking → Generate Domain** crea la dirección pública y compártela con el grupo.
7. Después del primer despliegue, vuelve a cargar la lista de los 54 alumnos en el panel del maestro: el Postgres de Railway arranca vacío.
8. Prueba: entra con unas iniciales de ejemplo, resuelve una pregunta y verifica que cargue la hoja simulada.

## Notas honestas

- Los resultados y la lista de alumnos se guardan en Postgres vía `DATABASE_URL` (handlers en `server/src/privileged.ts`, esquema en `postgres/0001_initial.sql`). Sin `DATABASE_URL` configurada, el examen se puede resolver y calificar en pantalla, pero el resultado no se guarda y el panel del maestro no puede leer la lista ni los resultados.
- La unicidad por alumno no depende del servidor: la variante (orden de preguntas, opciones y números de la hoja) se genera en el navegador a partir de las iniciales del alumno, así que funciona igual en ambos despliegues.
