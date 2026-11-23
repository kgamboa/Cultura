# Examen de Excel — despliegue en Railway
# Construye el cliente con Bun y lo sirve en el puerto que asigna Railway ($PORT).
FROM oven/bun:1 AS build
WORKDIR /app
COPY package.json bun.lock ./
# @hatch/space-sdk va vendored como directorio de texto dentro del repo
# (vendor/space-sdk: package.json + dist extraídos del paquete original) y
# package.json lo declara como `file:./vendor/space-sdk`, así que bun lo
# resuelve localmente sin rutas del entorno de Muse.
COPY vendor ./vendor
RUN bun install --frozen-lockfile || bun install
COPY . .
# El cliente se compila a client/dist con el script autónomo de Railway
# (client/build.mjs, el del SDK, solo corre dentro del pipeline de Muse).
# Ese script además genera server/.generated/privileged.contract.ts, que el
# servidor necesita para resolver el alias @space/privileged.
RUN bun ./client/build-railway.mjs
RUN ls client/dist
# El servidor real (server/serve-railway.ts): sirve client/dist Y atiende
# POST /actions ejecutando las acciones contra Postgres. Se compila a un
# solo archivo para que el arranque no dependa de alias ni de tsconfig.
RUN bun build ./server/serve-railway.ts --target=bun --outfile=./server/dist-railway/serve.js
RUN ls server/dist-railway

FROM oven/bun:1 AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
# Al arrancar: primero la migración automática (server/migrate.mjs aplica
# postgres/0001_initial.sql y crea las tablas en Postgres si no existen,
# sin pasos manuales; la lista de alumnos NO se carga aquí, se carga desde
# el panel del maestro). Después, el servidor real compilado
# (server/dist-railway/serve.js): sirve client/dist y atiende POST /actions
# con la base de datos, respetando $PORT. (El servidor estático anterior
# devolvía index.html también para /actions: ninguna acción se ejecutaba,
# el panel no pedía contraseña y el avance no se guardaba.)
EXPOSE 8080
CMD ["sh", "-c", "bun ./server/migrate.mjs; bun ./server/dist-railway/serve.js"]
