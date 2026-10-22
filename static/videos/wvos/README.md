# WVOS video previews

These five previews contain RGB frames and the supplied WVOS object annotations.
They are dataset annotations, not CoralMonSter predictions. The source polygon
labels and `group_id` identities remain unchanged, including the label `nemo` in
video7. The sequence selector uses the display title Clownfish for that clip.

The local source dataset has `images/<sequence>/00000.jpg` and
`annotate/<sequence>/00000.json` pairs. Files pair by filename stem. LabelMe
`imagePath` metadata is not used. The selected sequences are video1, video5,
video7, video24, and video45. This directory does not establish a license or
additional provenance for the supplied source material.

## Rebuild and check

Run from the repository root with Python, Pillow, ffmpeg, and ffprobe installed.
The source is read only. Output defaults to this directory.

```sh
python3 scripts/prepare_wvos_assets.py --source /path/to/WVOS
python3 tests/check_wvos_assets.py --source /path/to/WVOS
python3 tests/check_wvos_assets.py
```

The preparation script also accepts `--output DIR`. The manifest contains paths
relative to the website root under `static/videos/wvos/`; copy the complete
output there when preparing assets elsewhere.

Each MP4 contains one frame per source JPEG at a constant 24 FPS. This is preview
timing chosen for playback, not recovered capture timing. Duration is the frame
count divided by 24. The videos use H.264, yuv420p, CRF 23, faststart, and no audio.
Their longest dimension is at most 1280 pixels, with even dimensions and no
upscaling. Each JPEG poster comes from the first source frame.

`manifest.json` describes the encoded and original dimensions, frame count,
preview FPS, and local media paths. Each annotation JSON contains an ordered
`frames` array. A frame contains `{id, label, points}` polygons, with IDs stored
as strings and points in original image coordinates. Empty frames remain empty.
Multiple fragments of one object retain the same ID. Coordinates slightly
outside the image boundary remain intact; the canvas clips them when drawing.
No annotation simplification or embedded source image data is used.

The page loads only the selected clip near this section. It scales polygon
coordinates to the encoded video's dimensions and uses decoded media time to
choose `floor(time * 24)`, clamped to the clip's frame range. Serve the repository
over HTTP for the JSON requests, for example with `python3 -m http.server`.
