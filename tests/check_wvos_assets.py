#!/usr/bin/env python3
"""Check repository WVOS media, optionally against every original source pair."""
import argparse
from fractions import Fraction
import json
import math
from pathlib import Path
import struct
import subprocess

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
DIRECTORY = ROOT / 'static/videos/wvos'
EXPECTED = {
    'video1': ('Fish', 407, 1920, 1080),
    'video5': ('Dolphin', 271, 480, 852),
    'video7': ('Clownfish', 438, 3840, 2160),
    'video24': ('Shark', 329, 1920, 1080),
    'video45': ('Turtle', 191, 3840, 2160),
}


def check_polygons(frames, frame_count):
    assert isinstance(frames, list) and len(frames) == frame_count, 'Annotation frame count mismatch'
    for frame in frames:
        assert isinstance(frame, list), 'Frame must contain a polygon array'
        for polygon in frame:
            assert set(polygon) == {'id', 'label', 'points'}, 'Unexpected polygon metadata'
            assert isinstance(polygon['id'], str) and polygon['id'], 'Missing object identity'
            assert isinstance(polygon['label'], str) and polygon['label'], 'Missing source label'
            assert len(polygon['points']) >= 3, 'Polygon needs at least three points'
            for point in polygon['points']:
                assert len(point) == 2 and all(type(v) in (int, float) and math.isfinite(v) for v in point), 'Invalid polygon coordinate'


def check_source(source, clip, frames):
    clip_id = clip['id']
    images = sorted((source / 'images' / clip_id).glob('*.jpg'))
    annotations = sorted((source / 'annotate' / clip_id).glob('*.json'))
    stems = [f'{index:05d}' for index in range(clip['frameCount'])]
    assert [p.stem for p in images] == [p.stem for p in annotations] == stems, f'{clip_id}: source pairing mismatch'
    for index, (image_path, annotation_path) in enumerate(zip(images, annotations)):
        with Image.open(image_path) as image:
            assert image.size == (clip['sourceWidth'], clip['sourceHeight']), f'{clip_id}: source image dimensions'
        original = json.loads(annotation_path.read_text())
        assert (original['imageWidth'], original['imageHeight']) == (clip['sourceWidth'], clip['sourceHeight'])
        assert all(shape['shape_type'] == 'polygon' and shape['group_id'] is not None for shape in original['shapes'])
        expected = [{'id': str(shape['group_id']), 'label': shape['label'], 'points': shape['points']}
                    for shape in original['shapes']]
        assert frames[index] == expected, f'{clip_id} frame {index}: source identity, label, fragments or coordinates changed'


def check_faststart(path):
    atoms = []
    with path.open('rb') as stream:
        while True:
            header = stream.read(8)
            if not header:
                break
            assert len(header) == 8, 'Truncated MP4 atom'
            size, kind = struct.unpack('>I4s', header)
            header_size = 8
            if size == 1:
                size = struct.unpack('>Q', stream.read(8))[0]
                header_size = 16
            atoms.append(kind)
            if size == 0:
                break
            assert size >= header_size, 'Invalid MP4 atom size'
            stream.seek(size - header_size, 1)
    assert atoms.index(b'moov') < atoms.index(b'mdat'), 'MP4 must support faststart'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, help='Optional original WVOS dataset for exact source checks')
    args = parser.parse_args()
    manifest = json.loads((DIRECTORY / 'manifest.json').read_text())
    assert set(manifest) == {'clips'} and len(manifest['clips']) == 5, 'Expected five clips'
    assert [c['id'] for c in manifest['clips']] == list(EXPECTED), 'Unexpected clip selection or order'
    expected_files = {'manifest.json', 'README.md'}
    total_frames = 0
    for clip in manifest['clips']:
        clip_id = clip['id']
        title, frame_count, source_width, source_height = EXPECTED[clip_id]
        assert (clip['title'], clip['frameCount'], clip['sourceWidth'], clip['sourceHeight']) == (title, frame_count, source_width, source_height)
        assert clip['fps'] == 24, 'Preview timing must be 24 FPS'
        scale = min(1, 1280 / max(source_width, source_height))
        width, height = int(source_width * scale) // 2 * 2, int(source_height * scale) // 2 * 2
        assert (clip['width'], clip['height']) == (width, height), 'Incorrect encoded dimensions'
        for key, suffix in [('src', '.mp4'), ('poster', '-poster.jpg'), ('annotations', '.json')]:
            name = clip_id + suffix
            assert clip[key] == f'static/videos/wvos/{name}', 'Resources must remain local'
            expected_files.add(name)
        video_path = ROOT / clip['src']
        result = subprocess.run(['ffprobe', '-v', 'error', '-count_frames', '-show_entries',
                                 'stream=codec_type,codec_name,pix_fmt,width,height,nb_read_frames,r_frame_rate,avg_frame_rate,duration',
                                 '-of', 'json', str(video_path)], check=True, capture_output=True, text=True)
        streams = json.loads(result.stdout)['streams']
        assert len(streams) == 1 and streams[0]['codec_type'] == 'video', 'Expected video without audio'
        stream = streams[0]
        assert stream['codec_name'] == 'h264' and stream['pix_fmt'] == 'yuv420p', 'Expected browser-compatible H.264'
        assert (stream['width'], stream['height'], int(stream['nb_read_frames'])) == (width, height, frame_count), 'Encoded size/count mismatch'
        assert Fraction(stream['r_frame_rate']) == Fraction(stream['avg_frame_rate']) == 24, 'Encoded frame rate mismatch'
        assert abs(float(stream['duration']) - frame_count / 24) < .001, 'Encoded duration mismatch'
        check_faststart(video_path)
        with Image.open(ROOT / clip['poster']) as poster:
            assert poster.format == 'JPEG' and poster.size == (width, height), 'Poster dimensions mismatch'
        data = json.loads((ROOT / clip['annotations']).read_text())
        assert set(data) == {'frames'}, 'Unexpected annotation metadata'
        check_polygons(data['frames'], frame_count)
        if args.source:
            check_source(args.source, clip, data['frames'])
        total_frames += frame_count
        print(f'PASS: {clip_id}, {frame_count} aligned frames, {width}x{height}, H.264 at 24 FPS')
    assert {p.name for p in DIRECTORY.iterdir() if p.is_file()} == expected_files, 'Unexpected or missing generated files'
    print(f'PASS: {total_frames} local video/annotation frames' + (' match every source pair exactly' if args.source else ' validated without the source dataset'))


if __name__ == '__main__':
    main()
