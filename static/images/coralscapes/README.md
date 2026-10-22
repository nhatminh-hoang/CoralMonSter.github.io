# CoralScapes demo assets

These ten image–annotation pairs come from validation rows 0, 10, 20, 30, 40, 50, 60, 70, 80, and 90 of [EPFL-ECEO/CoralScapes](https://huggingface.co/datasets/EPFL-ECEO/coralscapes).

Both images and annotations were exported directly from `data/validation-00000-of-00001.parquet`. The files named `*-image.png` preserve the decoded original RGB pixels. The files named `*-mask.png` preserve the original grayscale class IDs without resizing, interpolation, palette conversion, or JPEG compression. Each photo and its annotation have the same 2048 × 1024 dimensions. The demo loads these files locally and performs no model inference.

The 39-class annotations are grouped for display as follows. All remaining class IDs stay transparent.

| Display group | Original class IDs |
| --- | --- |
| Coral alive | 6, 17, 21, 22, 25, 27, 28, 31, 34, 36 |
| Coral dead | 3, 20, 23, 32, 37 |
| Coral bleached | 4, 16, 19, 33 |

Source and taxonomy: [CoralScapes dataset documentation](https://huggingface.co/datasets/EPFL-ECEO/coralscapes/blob/main/README.md). Original dataset authors retain their rights. The dataset is distributed under [Apache License 2.0](LICENSE.txt).

To check the bundled file checksums, run `sha256sum -c static/images/coralscapes/SHA256SUMS` from the repository root.
