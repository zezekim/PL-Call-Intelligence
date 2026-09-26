#!/bin/sh
set -e
alembic upgrade head
exec uvicorn callsentry.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'
