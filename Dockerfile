# ARCH RUNNER — settlement service image.
#
# Node 20 service (server/index.ts, run via tsx) + the compiled Rust `arch-settle` signer
# (arch_sdk 0.12). The settlement-authority secret is NEVER baked into the image — it is
# injected at runtime as a mounted file (preferred) or env var via
# ARCH_SETTLEMENT_AUTHORITY_SECRET (a file path or 64-hex). See docs/HOSTING.md.

# ---- stage 1: build the Rust settlement signer ------------------------------------
FROM rust:1-bookworm AS signer
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
# arch-settle has a path dependency on ../../program, so preserve the repo layout.
COPY program ./program
COPY server/arch-settle ./server/arch-settle
RUN cargo build --release --manifest-path server/arch-settle/Cargo.toml
# -> /src/server/arch-settle/target/release/arch-settle

# ---- stage 2: runtime -------------------------------------------------------------
FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# tsx runs the TypeScript service directly (no bundling step needed server-side).
RUN npm install -g tsx@4.19.2

# Application source (TypeScript, executed by tsx). No secret is ever copied in.
COPY package.json ./package.json
COPY tsconfig.json ./tsconfig.json
COPY server ./server
COPY src ./src

# The signer binary built in stage 1 (the only native dependency).
COPY --from=signer /src/server/arch-settle/target/release/arch-settle \
                   /app/server/arch-settle/target/release/arch-settle
ENV ARCH_SETTLE_BIN=/app/server/arch-settle/target/release/arch-settle
ENV SETTLE_PORT=8790
EXPOSE 8790

# The authority secret is injected at RUN time, never here. Preferred: mount a file and point
#   ARCH_SETTLEMENT_AUTHORITY_SECRET at its path, e.g. /run/secrets/authority.json

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.SETTLE_PORT||8790)+'/health').then(r=>{if(!r.ok)process.exit(1);return r.json()}).then(j=>process.exit(j.ok?0:1)).catch(()=>process.exit(1))"

CMD ["tsx", "server/index.ts"]
