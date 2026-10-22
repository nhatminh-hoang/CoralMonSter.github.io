from pathlib import Path

from PIL import Image


directory = Path(__file__).resolve().parents[1] / 'static/images/coralscapes'
expected = {f'validation-{index:03d}-{kind}.png' for index in range(0, 100, 10) for kind in ['image', 'mask']}
assert {path.name for path in directory.glob('*.png')} == expected, 'Expected exactly ten image-mask pairs'
for index in range(0, 100, 10):
    with Image.open(directory / f'validation-{index:03d}-image.png') as image, Image.open(directory / f'validation-{index:03d}-mask.png') as mask:
        assert image.format == mask.format == 'PNG', f'Row {index}: images and masks must be lossless PNGs'
        assert image.mode == 'RGB' and mask.mode == 'L', f'Row {index}: expected RGB image and grayscale class IDs'
        assert image.size == mask.size == (2048, 1024), f'Row {index}: image and mask must align'
        invalid = {value for count, value in mask.getcolors(256) if value not in set(range(39)) | {255}}
        assert not invalid, f'Row {index}: invalid class IDs {sorted(invalid)}'
print('PASS: 10 local PNG pairs, aligned dimensions, exact class-ID encoding')
