FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/models/hf

# Text-to-speech pulls in PyTorch; leave it out unless the live receptionist
# is in use.
ARG WITH_TTS=0

WORKDIR /srv

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && if [ "$WITH_TTS" = "1" ]; then apt-get install -y --no-install-recommends espeak-ng; fi \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt requirements-tts.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt \
    && if [ "$WITH_TTS" = "1" ]; then pip install -r requirements-tts.txt; fi

COPY worker ./worker

RUN mkdir -p /models

EXPOSE 8100

CMD ["uvicorn", "worker.main:app", "--host", "0.0.0.0", "--port", "8100"]
