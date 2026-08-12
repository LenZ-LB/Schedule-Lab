FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

# Fly.io sets PORT; default to 8080 for local runs
ENV PORT=8080
CMD uvicorn app:app --host 0.0.0.0 --port ${PORT}
