#!/bin/bash
# Copy FFmpeg WASM files from node_modules to public/ for Vite to serve
mkdir -p public/ffmpeg
cp node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js public/ffmpeg/
cp node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm public/ffmpeg/
echo "[postinstall] FFmpeg WASM files copied to public/ffmpeg/"
