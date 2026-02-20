# ── Stage 1: Build ───────────────────────────────────────────────────────────
FROM python:3.12-slim AS builder
WORKDIR /app

RUN pip install --no-cache-dir pip --upgrade
COPY requirements.txt ./
RUN pip wheel --no-cache-dir --wheel-dir /wheels -r requirements.txt

# ── Stage 2: Production ───────────────────────────────────────────────────────
FROM python:3.12-slim AS runner
WORKDIR /app

# Non-root user (security best practice per devops-engineer skill)
RUN useradd -m -u 1001 appuser

# Install compiled wheels
COPY --from=builder /wheels /wheels
RUN pip install --no-cache-dir /wheels/* && rm -rf /wheels

# Copy app source
COPY --chown=appuser:appuser . .

USER appuser
EXPOSE 8000

# Health check — readiness probe for Railway/K8s
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
