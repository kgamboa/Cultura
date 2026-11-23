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
# (client/build.mjs, el del SDK, solo corre dentro del pipeline de Muse)
RUN bun ./client/build-railway.mjs
RUN ls client/dist

FROM oven/bun:1 AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
# Servidor estático mínimo para Railway: sirve client/dist y respeta $PORT
EXPOSE 8080
CMD ["sh", "-c", "bun -e \"const port=parseInt(process.env.PORT||'8080'); const server=Bun.serve({port, async fetch(req){ const url=new URL(req.url); let path=url.pathname==='/'?'/index.html':url.pathname; let file=Bun.file('./client/dist'+path); if(!(await file.exists())) file=Bun.file('./client/dist/index.html'); return new Response(file); }}); console.log('Examen de Excel escuchando en puerto '+server.port);\""]
