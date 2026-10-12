# App icons

Source artwork for the app icons (based on a Gemini draft, redrawn as vectors):

| Source              | Used for                                                                   |
| ------------------- | -------------------------------------------------------------------------- |
| `icon.svg`          | `src/app/apple-icon.png` (180 px), `public/icons/icon-192.png`, `-512.png` |
| `icon-maskable.svg` | `public/icons/icon-maskable-512.png` (motif inside Android's safe zone)    |
| `icon-small.svg`    | `src/app/icon.svg` (copied), `src/app/favicon.ico` (16/32/48 px)           |

To regenerate after a change, render each SVG at 1024 × 1024 (e.g. open it in a browser and take a
screenshot), then scale down with Pillow:

```python
from PIL import Image
icon = Image.open('icon-1024.png').convert('RGB')
icon.resize((180, 180), Image.LANCZOS).save('src/app/apple-icon.png')
# … 192 and 512 likewise; the favicon must be RGBA, otherwise Next.js fails to read it:
Image.open('icon-small-1024.png').convert('RGBA').save(
    'src/app/favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)]
)
```
