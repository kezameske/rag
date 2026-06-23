# FastAPI backend image. Build context = repo root.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Install deps first for layer caching
COPY backend/requirements.txt .
RUN pip install -r requirements.txt

# App code
COPY backend/app ./app

EXPOSE 8000

# Single worker: ingestion runs as in-process background tasks, so multiple
# workers/replicas would each only see their own tasks. Keep at 1 until a real
# job queue is added (roadmap Phase 3+).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
