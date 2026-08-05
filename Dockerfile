# Deno runtime
FROM denoland/deno:alpine
WORKDIR /app

# Dependencies first (layer caching)
COPY deno.json deno.lock ./
COPY main.ts lib/ tools/ ./
RUN deno cache main.ts

# Bind to all interfaces so the container is reachable on the LAN
ENV MCP_HOST=0.0.0.0
EXPOSE 8080
CMD ["deno", "task", "start"]
