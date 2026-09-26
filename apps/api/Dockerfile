# ──────────────────────────────────────────────────────────────────────────────
# Ideal Camas — Multi-Stage Dockerfile (Back-end Node.js API)
# ──────────────────────────────────────────────────────────────────────────────
# Estágios de Build:
#   1. Base: Imagem minimalista Node.js 20 Alpine com pnpm/npm.
#   2. Dependencies: Instalação de dependências de build e runtime.
#   3. Builder: Compilação TypeScript (tsc) e geração do Prisma Client.
#   4. Runner (Estágio Final): Imagem ultra-leve contendo APENAS o JavaScript
#      compilado e node_modules de produção. Executa sob usuário non-root (node).
# ──────────────────────────────────────────────────────────────────────────────

# ── ESTÁGIO 1: BASE DE DEPENDÊNCIAS ──
FROM node:20-alpine AS deps
RUN apk add --no-libc6-compat
WORKDIR /app

# Copiar arquivos de configuração da raiz do monorepo
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/

# Instalar dependências completas para compilação (inclui devDependencies)
RUN npm ci

# ── ESTÁGIO 2: BUILDER (COMPILAÇÃO) ──
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

# Gerar Prisma Client
WORKDIR /app/apps/api
RUN npx prisma generate

# Compilar pacotes TypeScript do monorepo
WORKDIR /app
RUN npx tsc -b packages/shared
WORKDIR /app/apps/api
RUN npx tsc

# Limpar dependências de dev para o estágio final
RUN npm prune --production

# ── ESTÁGIO 3: RUNNER (PRODUÇÃO SEGURA NON-ROOT) ──
FROM node:20-alpine AS runner
WORKDIR /app

# Definir variável de ambiente de produção
ENV NODE_ENV=production
ENV PORT=3001

# Criar usuário sem privilégios de root (Non-Root User)
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 appuser

# Copiar apenas os artefatos compilados e node_modules prunados
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json

# Ajustar permissões de propriedade de arquivos para o usuário non-root
RUN chown -R appuser:nodejs /app

# Alterar para o usuário sem privilégios (Non-Root)
USER appuser

# Expor a porta interna do container
EXPOSE 3001

# Healthcheck interno do container
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/api/health || exit 1

# Comando de inicialização
CMD ["node", "apps/api/dist/server.js"]
