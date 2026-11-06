FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir faster-whisper==1.2.1
WORKDIR /app
COPY server.py .
EXPOSE 9000
CMD ["python", "-u", "server.py"]
