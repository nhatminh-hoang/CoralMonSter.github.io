#!/usr/bin/env python3
"""Prepare the five local WVOS previews without changing the source dataset."""
import argparse
import json
import math
from pathlib import Path
import subprocess

from PIL import Image


CLIPS = [('video1', 'Fish'), ('video5', 'Dolphin'), ('video7', 'Clownfish'),
         ('video24', 'Shark'), ('video45', 'Turtle')]
FPS = 24


def read_sequence(source, clip_id):
    images = sorted((source / 'images' / clip_id).glob('*.jpg'))
    annotations = sorted((source / 'annotate' / clip_id).glob('*.json'))
    stems = [f'{index:05d}' for index in range(len(images))]
    if not images or [p.stem for p in images] != stems or [p.stem for p in annotations] != stems:
        raise ValueError(f'{clip_id}: expected consecutive image/annotation pairs from 00000')
    frames = []
    size = None
    for image_path, annotation_path in zip(images, annotations):
        with Image.open(image_path) as image:
            if size is None:
                size = image.size
            if image.size != size:
                raise ValueError(f'{image_path}: inconsistent image dimensions')
        data = json.loads(annotation_path.read_text())
        if (data['imageWidth'], data['imageHeight']) != size:
            raise ValueError(f'{annotation_path}: annotation dimensions do not match image')
        polygons = []
        for shape in data['shapes']:
            identity = shape.get('group_id')
            if (isinstance(identity, bool) or not isinstance(identity, (str, int, float))
                    or str(identity) == '' or isinstance(identity, float) and not math.isfinite(identity)):
                raise ValueError(f'{annotation_path}: missing or invalid group_id')
            label, points = shape['label'], shape['points']
            if shape['shape_type'] != 'polygon' or not isinstance(label, str) or not label or len(points) < 3:
                raise ValueError(f'{annotation_path}: expected labeled polygons with at least three points')
            if any(len(point) != 2 or any(isinstance(v, bool) or not isinstance(v, (int, float))
                   or not math.isfinite(v) for v in point) for point in points):
                raise ValueError(f'{annotation_path}: expected finite coordinate pairs')
            polygons.append({'id': str(identity), 'label': label, 'points': points})
        frames.append(polygons)
    return images, frames, size


def probe(path):
    result = subprocess.run(['ffprobe', '-v', 'error', '-count_frames', '-select_streams', 'v:0',
                             '-show_entries', 'stream=width,height,nb_read_frames,r_frame_rate,codec_name,pix_fmt,duration',
                             '-of', 'json', str(path)], check=True, capture_output=True, text=True)
    return json.loads(result.stdout)['streams'][0]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--output', type=Path, default=Path('static/videos/wvos'))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    clips = []
    for clip_id, title in CLIPS:
        images, frames, (source_width, source_height) = read_sequence(args.source, clip_id)
        scale = min(1, 1280 / max(source_width, source_height))
        width = int(source_width * scale) // 2 * 2
        height = int(source_height * scale) // 2 * 2
        video_path = args.output / f'{clip_id}.mp4'
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-threads', '2',
                        '-framerate', str(FPS), '-start_number', '0', '-i', str(images[0].parent / '%05d.jpg'),
                        '-frames:v', str(len(images)), '-vf', f'scale={width}:{height}', '-filter_threads', '1',
                        '-c:v', 'libx264', '-threads', '2', '-crf', '23', '-pix_fmt', 'yuv420p',
                        '-movflags', '+faststart', '-an', str(video_path)], check=True)
        encoded = probe(video_path)
        if (int(encoded['nb_read_frames']) != len(images) or encoded['r_frame_rate'] != '24/1'
                or (encoded['width'], encoded['height']) != (width, height)):
            raise ValueError(f'{clip_id}: encoded video does not match the source sequence')
        with Image.open(images[0]) as image:
            image.convert('RGB').resize((width, height), Image.LANCZOS).save(
                args.output / f'{clip_id}-poster.jpg', quality=88)
        (args.output / f'{clip_id}.json').write_text(json.dumps({'frames': frames}, separators=(',', ':'), allow_nan=False) + '\n')
        prefix = 'static/videos/wvos/'
        clips.append({'id': clip_id, 'title': title, 'src': prefix + f'{clip_id}.mp4',
                      'poster': prefix + f'{clip_id}-poster.jpg', 'annotations': prefix + f'{clip_id}.json',
                      'fps': FPS, 'frameCount': len(images), 'sourceWidth': source_width,
                      'sourceHeight': source_height, 'width': width, 'height': height})
        print(f'{clip_id}: {len(images)} frames, {width}x{height}, {video_path.stat().st_size:,} video bytes', flush=True)
    (args.output / 'manifest.json').write_text(json.dumps({'clips': clips}, indent=2) + '\n')


if __name__ == '__main__':
    main()
