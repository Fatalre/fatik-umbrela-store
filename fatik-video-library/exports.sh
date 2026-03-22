#!/usr/bin/env bash
set -euo pipefail

DOCKERHUB_USER="${DOCKERHUB_USER:-yourdockerhubusername}"
APP_ID="fatik-video-library"
APP_VERSION="0.1.0"
IMAGE_NAME="${DOCKERHUB_USER}/${APP_ID}:${APP_VERSION}"

echo "Building ${IMAGE_NAME}..."
docker build -t "${IMAGE_NAME}" ./server

echo "Pushing ${IMAGE_NAME}..."
docker push "${IMAGE_NAME}"

echo "Done."
echo "Use this image in docker-compose.yml:"
echo "image: ${IMAGE_NAME}"