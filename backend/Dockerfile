# ── Stage 1: Build ───────────────────────────────────────────────────────────
FROM python:3.12-slim AS builder
WORKDIR /build

# Install build-time OS deps (if any wheels need compilation)
RUN apt-get update && apt-get install -y --no-install-recommends gcc && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir --upgrade pip
COPY requirements.txt ./
RUN pip wheel --no-cache-dir --wheel-dir /wheels -r requirements.txt

# ── Stage 2: Production ─────────────────────────────────────────────────────
FROM python:3.12-slim AS runner
WORKDIR /app

# Non-root user (security best practice)
RUN groupadd -g 1001 appgroup && useradd -m -u 1001 -g appgroup appuser

# Install compiled wheels — no compilers in final image
COPY --from=builder /wheels /wheels
RUN pip install --no-cache-dir /wheels/* && rm -rf /wheels

# Copy app source
COPY --chown=appuser:appgroup . .

# Drop to non-root
USER appuser

# Railway injects $PORT at runtime; default to 8000
ENV PORT=8000
EXPOSE ${PORT}

# Health check — used by Docker, Railway, and K8s
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:${PORT}/health')" || exit 1

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT}"]
