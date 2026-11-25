#!/bin/sh
set -eu

flask --app wsgi db upgrade
flask --app wsgi seed

exec gunicorn \
  --bind "0.0.0.0:${PORT:-10000}" \
  --workers 1 \
  --threads 4 \
  --timeout 120 \
  wsgi:app
