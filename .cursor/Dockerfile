# Cursor Cloud Agent base image.
# Debian/Ubuntu-family base keeps computer use supported.
# Do not COPY the project — Cursor checks out the correct commit.
FROM node:24.20.0-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    git \
    sudo \
    build-essential \
    python3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /home/ubuntu
