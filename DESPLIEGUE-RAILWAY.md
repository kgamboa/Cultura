# Publicar el Examen de Excel en Railway

Guía rápida para el maestro. La versión que vive dentro de Muse ya funciona y guarda resultados; estos archivos preparan el mismo proyecto para publicarlo también en Railway.

## Archivos incluidos

| Archivo | Para qué sirve |
|---|---|
| `railway.json` | Le dice a Railway que construya con el `Dockerfile` y reinicie el servicio si falla. |
| `Dockerfile` | Construye el cliente con Bun y lo sirve en el puerto `$PORT` que asigna Railway. |
| `vendor/space-sdk/` | El paquete `@hatch/space-sdk` extraído como directorio de texto (`package.json` + `dist`). `package.json` lo declara como dependencia `file:./vendor/space-sdk`, así que `bun install` lo resuelve localmente en cualquier entorno, sin rutas de Muse. Va como texto (sin el `.tgz` binario anterior) para que el repo se pueda subir completo a GitHub. No incluye `dist/pdfjs-assets/` (binarios de pdf.js: cmaps, fuentes y wasm): este examen no usa el visor de PDF del SDK, así que no hacen falta. |
| `client/build-railway.mjs` | Compila el cliente dentro del contenedor. El build normal (`client/build.mjs`, del SDK) solo corre dentro de Muse, así que Railway usa este script equivalente con la misma salida (`client/dist`). |
| `.env.example` | Plantilla de variables de entorno documentadas (no subas un `.env` real con claves). |

## Pasos

1. Sube esta carpeta a un repositorio de GitHub (sin `node_modules` ni `app.db`).
2. En [railway.com](https://railway.com): **New Project → Deploy from GitHub repo** y elige el repositorio.
3. Railway detecta `railway.json` y el `Dockerfile` automáticamente. No necesitas comando de inicio: el contenedor ya lo trae.
4. Enlaza un servicio **Postgres** al proyecto y verifica en **Variables**:
   - `PORT`: lo inyecta Railway, no lo escribas.
   - `NODE_ENV=production`.
   - `DATABASE_URL`: la crea Railway al enlazar el Postgres. Es **requerida**: ahí se guardan los resultados (`exam_results`), la lista de alumnos (`roster_entries`) y la contraseña del maestro (`app_settings`). El SQLite local ya no es el almacén.
5. **No tienes que aplicar ninguna migración a mano:** al arrancar, el contenedor corre `server/migrate.mjs`, que ejecuta `postgres/0001_initial.sql` y crea las tablas (`exam_results`, `roster_entries`, `app_settings`, `exam_progress`) si no existen. Es idempotente: se corre en cada despliegue sin borrar datos. La base ya no queda vacía. (Si algún día quieres correrla tú: `psql "$DATABASE_URL" -f postgres/0001_initial.sql`; y los handlers también crean las tablas en el primer uso, como respaldo.)
6. En **Settings → Networking → Generate Domain** crea la dirección pública y compártela con el grupo.
7. Después del primer despliegue, abre el **panel del maestro** y define la contraseña (ver la sección siguiente); hasta definirla, el panel no muestra la lista ni los resultados. Ya con el panel desbloqueado, carga la lista de los 54 alumnos **una sola vez desde el panel**: las tablas se crean solas al arrancar, pero la lista NO va en el repositorio (es público y trae nombres de alumnos), así que ningún despliegue la sube automáticamente.
8. Prueba: entra con unas iniciales de ejemplo, resuelve una pregunta y verifica que cargue la hoja simulada.

## Contraseña del maestro

El panel del maestro (lista de alumnos y resultados guardados) está protegido con contraseña. Los alumnos **no** necesitan contraseña para entrar a su examen.

- **Cómo se define:** la primera vez que se abre el panel del maestro, la app pide crear la contraseña (escribirla dos veces) y la guarda en el servidor en ese momento. No hay contraseña por defecto ni variable de entorno para esto.
- **Dónde se guarda:** en Postgres, tabla `app_settings`, fila `teacher_password_hash`. Solo se guarda el **hash SHA-256** de la contraseña, nunca la contraseña en claro.
- **Cómo se verifica:** cada vez que se desbloquea el panel, la contraseña escrita se compara **en el servidor** contra ese hash; el panel no muestra la lista ni los resultados hasta que la verificación pasa. Guardar o borrar la lista y leer los resultados también exigen la contraseña verificada en el servidor en cada llamada.
- **Si la olvidas:** no hay recuperación en la app. Borra la fila en el Postgres de Railway (`DELETE FROM app_settings WHERE key = 'teacher_password_hash';`) y el panel volverá a pedir definir una contraseña nueva la próxima vez que se abra.

## Notas honestas

- Los resultados y la lista de alumnos se guardan en Postgres vía `DATABASE_URL` (handlers en `server/src/privileged.ts`, esquema en `postgres/0001_initial.sql`). Sin `DATABASE_URL` configurada, el examen se puede resolver y calificar en pantalla, pero el resultado no se guarda y el panel del maestro no puede leer la lista ni los resultados.
- La unicidad por alumno no depende del servidor: la variante (orden de preguntas, opciones y números de la hoja) se genera en el navegador a partir de las iniciales del alumno, así que funciona igual en ambos despliegues.
