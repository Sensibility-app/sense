#!/bin/sh
# Entrypoint for Sense user container
# Handles first-run initialization and self-modified code preservation

set -e

# Check if code already exists (self-modified)
if [ ! -f "/app/server/main.ts" ]; then
  # First run: copy template to /app
  echo "First run detected. Copying template from /app/template to /app..."
  cp -r /app/template/* /app/
  echo "Template copied successfully."
else
  # Subsequent runs: use existing code (may be self-modified)
  echo "Existing code detected. Using current /app directory..."
fi

# Start the Sense application
echo "Starting Sense application..."
cd /app
deno task start
