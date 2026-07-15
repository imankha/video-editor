FROM python:3.11-slim

# T5070: deploy commit id, advertised at runtime via app/version.py -> X-App-Version
# header + GET /api/version (the update-gate's backend-only-deploy handshake).
ARG COMMIT_SHA=unknown
ENV COMMIT_SHA=${COMMIT_SHA}

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.prod.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
