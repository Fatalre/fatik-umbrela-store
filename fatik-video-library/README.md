# fatik-video-library

A folder-based video library app for Umbrel.

## Features planned for V1

- Real folder tree navigation
- Movies and series stored in their own folders
- Local metadata extraction with ffprobe
- Poster generation from video frames
- Original video streaming
- HLS playback foundation
- Modern dark UI
- Watched state and playback progress

## Data layout

```text
/data/
├─ library/
│  ├─ Movies/
│  ├─ Series/
│  └─ Other/
├─ cache/
│  ├─ posters/
│  ├─ hls/
│  └─ db.json
└─ config/
   └─ settings.json