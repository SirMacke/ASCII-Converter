# ASCII Converter

Turns JPEG, PNG and GIF images into ASCII art. It comes in three parts that share one conversion engine:

- a command-line tool, `ascii-converter`
- a small TypeScript library with no I/O, so it runs in Node and in browsers
- a static web page that converts images in the browser

![examples/cube.jpg converted with --color, rendered as HTML](examples/cube-color.png)

The image above is [`examples/cube.jpg`](examples/cube.jpg) converted with `ascii-converter examples/cube.jpg -w 100 --color --out cube.html` and screenshotted in a browser. The plain-text version below comes from `ascii-converter examples/cube.jpg -w 64 --invert --brightness 0.1`:

```text
                   ..                   ..
               ..:-----:..          ...........
            .:-------------::.   ..................
          .=--------------:::..................::::
          .----=----:::::...................:::::::
          .----------:..  .............::::::::::::
          .----------:.:::::........:::--::::::::::
          .----------:::-------:::---::---:::::::::
          .-----------::------==----------:::::::::
          .===--------------====----------::::::...
          .===+===---------=====----------::.......
          .=======++==--========--------::.........
          .===========:::----===-----::::..........
          .===========::::::::---:::...............
          .+++++======::::::::::........:..........
          .=+++++++===::::::::::.......::........
             .:-=++++=::::::::::.....::::.....
                  .-==::::::::::..:::::::.
                       .:::::::::::::..
                           ..::::..
```

## Command line

Requires Node.js 20 or later.

```sh
npx @sirmacke/ascii-converter photo.jpg
```

Or install it globally to get the `ascii-converter` command:

```sh
npm install --global @sirmacke/ascii-converter
ascii-converter photo.jpg --color
```

By default the output is as wide as your terminal (80 columns when piped or written to a file), and the height follows from the image's aspect ratio.

```sh
ascii-converter photo.jpg --width 120 --color        # 120 columns, ANSI colour
ascii-converter logo.png --invert --ramp blocks      # for a light terminal, using ░▒▓█
ascii-converter photo.jpg --out photo.html --color   # a standalone web page
ascii-converter photo.jpg --out photo.txt            # plain text
ascii-converter dance.gif --animate --color          # play a GIF in place, Ctrl+C to stop
curl -s https://example.com/cat.png | ascii-converter -
```

### Options

| Option | Default | What it does |
| --- | --- | --- |
| `-w, --width <n>` | terminal width, or 80 | Output width in characters. |
| `-H, --height <n>` | none | Maximum height in rows. With `--width`, the image is fitted inside both. |
| `-r, --ramp <ramp>` | `standard` | Characters from lightest to densest: a preset or your own string, e.g. `" .oO@"`. |
| `-i, --invert` | off | Use dense characters for dark pixels. Turn this on for light backgrounds. |
| `-c, --color` | off | Colour each character with the average colour under it. ANSI codes in the terminal, `<span>`s in HTML. |
| `--color-depth <d>` | auto | `truecolor` (24-bit) or `256`. Auto picks truecolor when `COLORTERM` says so or in Windows Terminal. |
| `-d, --dither` | off | Floyd-Steinberg dithering between characters. Helps with smooth gradients and short ramps. |
| `-b, --brightness <n>` | `0` | Added to brightness, from -1 to 1. |
| `--contrast <n>` | `1` | Contrast multiplier around mid-grey. `0` flattens everything to grey. |
| `-g, --gamma <n>` | `1` | Values above 1 brighten mid-tones, below 1 darken them. |
| `--char-aspect <n>` | `2` | Height of a character cell divided by its width. Most terminal fonts are close to 2. |
| `-a, --animate` | off | Play every frame of an animated GIF. The height is capped to the terminal so frames redraw in place. |
| `--loops <n>` | forever | With `--animate`, stop after `n` loops. |
| `-o, --out <file>` | stdout | `.html` or `.htm` writes a web page. Any other extension writes text (with ANSI codes if `--color` is on). |

Ramp presets:

| Name | Characters |
| --- | --- |
| `standard` | `` .:-=+*#%@`` |
| `detailed` | the 70-character ramp from the original 2022 version of this project |
| `blocks` | `` ░▒▓█`` |
| `minimal` | `` .:#`` |

Exit codes: `0` on success, `1` if the image can't be read or decoded, `2` for invalid arguments.

**Formats.** JPEG, PNG and GIF are decoded with pure-JavaScript libraries ([jpeg-js](https://github.com/jpeg-js/jpeg-js), [pngjs](https://github.com/pngjs/pngjs), [omggif](https://github.com/deanm/omggif)), so installing needs no compiler or native binaries. The format is detected from the file contents, not the extension. JPEG EXIF orientation is applied, so phone photos come out upright. WebP, BMP and TIFF are rejected with an error; convert them to PNG first.

**Dark or light background.** Without `--invert`, bright pixels get dense characters, which suits a dark terminal: the picture looks like the photo. A photo with a light background, like the cube, then turns into a wall of `@`. `--invert` flips the mapping. On a dark terminal that gives a negative, which is often the more readable result.

## Library

```sh
npm install @sirmacke/ascii-converter
```

The main entry point is pure: it takes RGBA pixels and returns text. It has no dependencies and does no I/O. Decoding image files lives in the separate `/node` entry point.

```js
import { asciify } from '@sirmacke/ascii-converter';
import { readImage } from '@sirmacke/ascii-converter/node';

const image = await readImage('photo.jpg'); // { data, width, height }
console.log(asciify(image, { width: 80, invert: true }));
console.log(asciify(image, { width: 80, color: true })); // ANSI truecolor
```

In a browser, pass `ImageData` from a canvas:

```js
import { asciify } from '@sirmacke/ascii-converter';

const ctx = canvas.getContext('2d');
ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
pre.textContent = asciify(ctx.getImageData(0, 0, canvas.width, canvas.height), { width: 100 });
```

### API

From `@sirmacke/ascii-converter`:

- `asciify(image, options?)` returns a string. Takes every option below plus `color: boolean | 'truecolor' | '256'`.
- `convert(image, options?)` returns `{ columns, rows, chars, colors }`: one character per cell and an RGB byte triple per cell. Use it with the renderers when you need more than one output format.
- `toText(art)`, `toAnsi(art, 'truecolor' | '256')` and `toHtml(art, { color, standalone, theme, title })` render the result of `convert`.
- `gridSize(imageWidth, imageHeight, { width, height, charAspect })` returns the `{ columns, rows }` an image would get.
- `RAMPS`, `resolveRamp(ramp)` and `rgbTo256(r, g, b)` are the presets and helpers used internally.

`image` is anything shaped like `{ data, width, height }`, where `data` holds 4 bytes (RGBA) per pixel: `ImageData`, a `Uint8Array`, a `Buffer` or a plain array.

Options, with the CLI flag they correspond to:

| Option | Type | Default | CLI |
| --- | --- | --- | --- |
| `width` | number | 80 if `height` is unset | `--width` |
| `height` | number | from aspect ratio | `--height` |
| `ramp` | preset name or string | `'standard'` | `--ramp` |
| `invert` | boolean | `false` | `--invert` |
| `brightness` | number, -1 to 1 | `0` | `--brightness` |
| `contrast` | number, 0 or more | `1` | `--contrast` |
| `gamma` | number above 0 | `1` | `--gamma` |
| `dither` | boolean | `false` | `--dither` |
| `charAspect` | number above 0 | `2` | `--char-aspect` |

Invalid options throw a `RangeError` or `TypeError` that names the option.

From `@sirmacke/ascii-converter/node`:

- `readImage(path)` reads and decodes a JPEG, PNG or GIF (first frame).
- `decodeImage(bytes)` does the same for a `Uint8Array` or `Buffer`.
- `decodeFrames(bytes)` returns every GIF frame, composited, with its `delay` in milliseconds.
- `detectFormat(bytes)` returns `'jpeg'`, `'png'`, `'gif'`, `'webp'`, `'bmp'`, `'tiff'` or `undefined`.

## Web preview

`web/` contains a single page: drop, paste or pick an image, then adjust the same options as the CLI. The conversion runs in your browser, so the image is never uploaded. You can copy the result or download it as `.txt` or `.html`. The page measures the monospace font it renders with, so the aspect ratio matches what's on screen.

```sh
npm install
npm run dev:web      # http://localhost:5173/
npm run build:web    # static files in web/dist, relative paths, host anywhere
```

The web page shows the first frame of animated GIFs.

## Development

```sh
npm install
npm test             # builds, then runs the vitest suite
npm run typecheck    # library, CLI, tests and web page
node dist/cli/bin.js examples/cube.jpg --color
```

```text
src/core/   conversion, ramps and renderers (no I/O, browser-safe)
src/node/   JPEG / PNG / GIF decoding for Node
src/cli/    argument parsing and terminal output
web/        the browser page (Vite)
test/       unit tests for the core, decoders and CLI
examples/   sample image and outputs generated by the tool
```

## Background

This started in 2022 as a Node script that read settings from `variables.json`. In 2023 it was partly turned into a Nuxt site. Version 2 replaces both. The old settings map to the new options like this:

- `darkOrLight: false`, the old default, put dense characters on dark pixels. That is `--invert` now.
- `asciiHeight: 100` resized the image to 100 pixels and printed every second row, so about `--height 50`.
- `grayScaleBias` added spaces to the light end of the ramp so more pale pixels became blank. With `--invert`, a positive `--brightness` does the same job.
- The `detailed` ramp preset is the original character set.

## License

[MIT](LICENSE) © Maxmilian Helmersson
