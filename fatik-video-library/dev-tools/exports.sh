#!/usr/bin/env bash
set -euo pipefail

DOCKERHUB_USER="fatalre"
APP_ID="fatik-video-library"
APP_VERSION="0.1.0"
IMAGE_NAME="${DOCKERHUB_USER}/${APP_ID}:${APP_VERSION}"
LATEST_NAME="${DOCKERHUB_USER}/${APP_ID}:latest"

docker buildx inspect fatik-builder >/dev/null 2>&1 || docker buildx create --use --name fatik-builder
docker buildx inspect --bootstrap

docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t "${IMAGE_NAME}" \
  -t "${LATEST_NAME}" \
  --push \
  ./server

echo "Done."
echo "Published images:"
echo "  ${IMAGE_NAME}"
echo "  ${LATEST_NAME}"