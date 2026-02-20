# pixoo-toolkit — Project Reference

## Device

| Property | Value |
|---|---|
| Models | Divoom Pixoo-16, Pixoo-32, Pixoo-64 |
| Resolutions | 16×16, 32×32, 64×64 RGB LED matrix |
| Connectivity | Wi-Fi (2.4GHz), Bluetooth |
| Local IP | `<device-ip>` (configurable via `PIXOO_IP` env var) |
| Firmware API | HTTP REST (JSON POST) |

## Goal

Full programmatic control of Divoom Pixoo displays from Claude Code. Build custom visuals, animations, dashboards, and interactive displays — bypassing the Divoom app entirely.

## Local HTTP API

All commands go to a single endpoint via POST:

```
POST http://<device-ip>/post
Content-Type: application/json
```

Every request body contains a `"Command"` field. Response always includes `"error_code"` (0 = success).

```bash
# Example: get device config
curl -s -X POST http://<device-ip>/post \
  -H "Content-Type: application/json" \
  -d '{"Command":"Channel/GetAllConf"}'
```

### Command Reference

#### Channel / Display Control

| Command | Description | Key Parameters |
|---|---|---|
| `Channel/GetAllConf` | Get all device settings | — |
| `Channel/GetIndex` | Get current channel (0=Faces, 1=Cloud, 2=Visualizer, 3=Custom) | — |
| `Channel/SetIndex` | Switch channel | `SelectIndex` (0–3) |
| `Channel/SetBrightness` | Set brightness | `Brightness` (0–100) |
| `Channel/OnOffScreen` | Turn screen on/off | `OnOff` (0=off, 1=on) |
| `Channel/SetClockSelectId` | Set clock face | `ClockId` |
| `Channel/SetCustomPageIndex` | Select custom page | `CustomPageIndex` |
| `Channel/GetClockInfo` | Get clock face info | `ClockId` |

#### Drawing / Animation

| Command | Description | Key Parameters |
|---|---|---|
| `Draw/SendHttpGif` | Send pixel frame(s) to display | `PicNum`, `PicWidth`, `PicOffset`, `PicID`, `PicSpeed`, `PicData` |
| `Draw/CommandList` | Batch commands (NOT for multi-frame GIFs) | `CommandList` |
| `Draw/SetScroll` | Set scroll behavior | — |

##### `Draw/SendHttpGif` — The Core Drawing Command

This is the primary way to push custom visuals to the device.

```json
{
  "Command": "Draw/SendHttpGif",
  "PicNum": 1,
  "PicWidth": 64,
  "PicOffset": 0,
  "PicID": 1,
  "PicSpeed": 100,
  "PicData": "<base64-encoded RGB data>"
}
```

**PicData encoding:**
1. `PicWidth × PicWidth` pixels, each pixel = 3 bytes (R, G, B). For Pixoo-64: 64×64 = 12,288 bytes per frame.
2. Pixel order: left-to-right, top-to-bottom (row-major)
3. Base64-encode the raw byte array
4. For animations: send multiple frames sequentially (same `PicID`, incrementing `PicOffset`)
   - `PicNum` = total frame count
   - `PicOffset` = current frame index (0-based)
   - `PicSpeed` = ms per frame

**Limits & quirks:**
- **Must call `Draw/ResetHttpGifId` before pushing** — without this, the device silently ignores frames. The `PixooClient.push()` method does this automatically.
- Max ~40 frames before potential device crash
- Each new animation triggers a ~5s "Loading.." overlay
- `Draw/CommandList` CANNOT batch multi-frame sends — must loop individual `Draw/SendHttpGif` calls
- Display may freeze after ~300 consecutive pushes (firmware bug) — periodically reset connection
- Previous frame may partially bleed through (firmware buffer issue)

#### Text / Scrolling

| Command | Description | Key Parameters |
|---|---|---|
| `Draw/SendHttpText` | Send scrolling text | `TextId`, `x`, `y`, `dir`, `font`, `TextWidth`, `TextString`, `speed`, `color`, `align` |
| `Draw/ClearHttpText` | Clear text overlay | `TextId` |

Text overlays render on top of the current frame. 115 fonts available (some have special characters — font 18 has arrow glyphs, font 20 has °C/°F).

Font list: `https://app.divoom-gz.com/Device/GetTimeDialFontList`

#### System

| Command | Description | Key Parameters |
|---|---|---|
| `Sys/GetConf` | Get system config | — |
| `Sys/PlayTFGif` | Play GIF from SD card | `FileName` |
| `Sys/SetText` | System text | — |
| `Device/SetUTC` | Set timezone/UTC offset | `Utc` |

#### Tools

| Command | Description | Key Parameters |
|---|---|---|
| `Tools/SetTimer` | Set countdown timer | `Minute`, `Second`, `Status` |
| `Tools/SetStopWatch` | Control stopwatch | `Status` (0=stop, 1=start, 2=reset) |
| `Tools/SetScoreBoard` | Set scoreboard display | `BlueScore`, `RedScore` |
| `Tools/SetNoiseStatus` | Toggle noise meter | `NoiseStatus` |

#### Buzzer

```json
{
  "Command": "Device/PlayBuzzer",
  "ActiveTimeInCycle": 500,
  "OffTimeInCycle": 500,
  "PlayTotalTime": 3000
}
```

### Full Command List (from APK decompilation)

<details>
<summary>All known commands (~200+)</summary>

**Alarm:** `Alarm/Change`, `Alarm/Del`, `Alarm/DelAll`, `Alarm/Get`, `Alarm/Set`

**Channel:** `Channel/AddEqData`, `Channel/AddHistory`, `Channel/CleanCustom`, `Channel/CustomChange`, `Channel/DelHistory`, `Channel/DeleteCustom`, `Channel/DeleteEq`, `Channel/EqDataChange`, `Channel/GetAll`, `Channel/GetAllCustomTime`, `Channel/GetClockConfig`, `Channel/GetClockInfo`, `Channel/GetClockList`, `Channel/GetConfig`, `Channel/GetCurrent`, `Channel/GetCustomList`, `Channel/GetCustomPageIndex`, `Channel/GetEqDataList`, `Channel/GetEqPosition`, `Channel/GetEqTime`, `Channel/GetIndex`, `Channel/GetNightView`, `Channel/GetSongInfo`, `Channel/GetStartupChannel`, `Channel/GetSubscribe`, `Channel/GetSubscribeTime`, `Channel/ItemSearch`, `Channel/OnOffScreen`, `Channel/ResetClock`, `Channel/SetAllCustomTime`, `Channel/SetBrightness`, `Channel/SetClockConfig`, `Channel/SetClockSelectId`, `Channel/SetConfig`, `Channel/SetCurrent`, `Channel/SetCustom`, `Channel/SetCustomId`, `Channel/SetCustomPageIndex`, `Channel/SetEqPosition`, `Channel/SetEqTime`, `Channel/SetIndex`, `Channel/SetNightView`, `Channel/SetProduceTime`, `Channel/SetStartupChannel`, `Channel/SetSubscribe`, `Channel/SetSubscribeTime`

**Cloud (remote API):** `Cloud/GalleryInfo`, `Cloud/GalleryUpload11`, `Cloud/GalleryUploadV3`, `Cloud/GetExpertGallery`, `Cloud/GetHotExpert`, `Cloud/GetHotTag`, `Cloud/ToDevice`, `Cloud/UploadLocal`

**Device:** `Device/AppRestartMqtt`, `Device/BindUser`, `Device/Connect`, `Device/ConnectApp`, `Device/DeleteResetAll`, `Device/Disconnect`, `Device/GetDeviceId`, `Device/GetFileByApp`, `Device/GetList`, `Device/GetNewBind`, `Device/GetUpdateFileList`, `Device/GetUpdateInfo`, `Device/Hearbeat`, `Device/NotifyUpdate`, `Device/ResetAll`, `Device/SetLog`, `Device/SetName`, `Device/SetPlace`, `Device/SetUTC`, `Device/ShareDevice`, `Device/TestNotify`, `Device/Unbind`

**Draw:** `Draw/ExitSync`, `Draw/GetPaletteColorList`, `Draw/NeedEqData`, `Draw/NeedLocalData`, `Draw/NeedSendDraw`, `Draw/SendLocal`, `Draw/SendRemote`, `Draw/SetInfo`, `Draw/SetPaletteColor`, `Draw/SetScroll`, `Draw/SetSpeedMode`, `Draw/UpLoadAndSend`, `Draw/UpLoadEqAndSend`

**Game:** `Game/Enter`, `Game/Exit`, `Game/Play`

**LED:** `Led/SendData`, `Led/SetText`, `Led/SetTextSpeed`, `Led/Stop`

**Sleep:** `Sleep/ExitTest`, `Sleep/Get`, `Sleep/Set`, `Sleep/Test`

**System:** `Sys/GetConf`, `Sys/PlayTFGif`, `Sys/SetAPO`, `Sys/SetConf`, `Sys/SetLightBack`, `Sys/SetLightColor`, `Sys/SetLightFront`, `Sys/SetLogo`, `Sys/SetNotifySound`, `Sys/SetText`, `Sys/SetTextDirection`, `Sys/TimeZoneSearch`

**TimePlan:** `TimePlan/Change`, `TimePlan/Close`, `TimePlan/Del`, `TimePlan/GetList`, `TimePlan/GetPlan`, `TimePlan/Set`

**Tools:** `Tools/GetNoiseStatus`, `Tools/GetScoreBoard`, `Tools/GetStopWatch`, `Tools/GetTimer`, `Tools/SetNoiseStatus`, `Tools/SetScoreBoard`, `Tools/SetStopWatch`, `Tools/SetTimer`

</details>

### Remote / Cloud API

Base URL: `https://appin.divoom-gz.com/`

Requires authentication (email + MD5 password → `Token` + `UserId`). Has additional features not available locally: alarms, gallery uploads, social features, discovery.

Device discovery (no auth): `POST https://app.divoom-gz.com/Device/ReturnSameLANDevice`

## Current Device State (as of initial setup)

```json
{
  "Brightness": 100,
  "RotationFlag": 0,
  "ClockTime": 60,
  "GalleryTime": 60,
  "PowerOnChannelId": 0,
  "CurClockId": 64,
  "Time24Flag": 0,
  "TemperatureMode": 1,
  "GyrateAngle": 0,
  "MirrorFlag": 0,
  "LightSwitch": 1,
  "SelectIndex": 0
}
```

## Project Structure

```
assets/         Source images (PNGs) for sprites — drop files here
scripts/        Reusable display scripts (hello-claude.ts, demo.ts, etc.)
output/         Generated PNG previews — do not commit
src/
  canvas.ts     Square pixel buffer (16/32/64) + drawing primitives
  client.ts     PixooClient — HTTP device control, push frames/animations
  color.ts      RGB/HSL types, named colors, lerp, dim
  font.ts       Bitmap fonts (FONT_5x7, FONT_3x5), drawText, measureText
  image.ts      Image loading (sharp), sprite downsampling + rendering
  animation.ts  Multi-frame animation builder
  preview.ts    Zero-dep PNG encoder, savePng()
  svg-path.ts   SVG path parser + polygon rasterizer
  index.ts      Barrel export
tests/          Vitest tests (one per src module)
```

Scripts go in `scripts/`, output PNGs go in `output/`, source images go in `assets/`.
Run scripts: `bun run build && bun dist/scripts/<name>.js`
Set `PIXOO_IP` env var to your device's local IP address. Set `PIXOO_SIZE` to `16` or `32` for non-64 displays. See `.env.example`.

### Loading sprites from PNGs

Drop a PNG in `assets/`, then:

```typescript
import { downsampleSprite, renderSprite } from '../src/index.js';

// Analyze image → grid of cols×rows cells with auto-detected colors
const sprite = await downsampleSprite('assets/clawd.png', 10, 8);

// Render onto canvas at scale, centered
renderSprite(canvas, sprite.grid, { scale: 4, y: 24 });
```

`downsampleSprite` finds the bounding box, samples each cell center,
and classifies pixels as body color, dark/eye color, or transparent.
`renderSprite` supports color overrides for recoloring.

For full-resolution images (no grid), use `loadImage`:

```typescript
import { loadImage } from '../src/index.js';

// Resize any image to canvas size with nearest-neighbor (pixel-art crisp)
const canvas = await loadImage('assets/photo.png');

// Or render into a region of an existing canvas
await loadImage('assets/icon.png', { canvas, x: 10, y: 10, width: 20, height: 20 });
```

## Tech Stack

- **Runtime:** Bun / TypeScript (ESM)
- **Dependencies:** `sharp` (image loading/resize)
- **HTTP:** Native `fetch` for device API
- **Rendering:** Pure TypeScript pixel math for canvas/drawing
- **Encoding:** Base64 for `PicData` payloads
- **PNG export:** Hand-rolled encoder using `node:zlib` (Bun-compatible)
- **Testing:** Vitest (`tests/` directory, `bun run test`)

## Community References

| Resource | URL |
|---|---|
| Official API docs | http://doc.divoom-gz.com/web/#/12?page_id=196 |
| Divoom help center (SDK) | https://www.divoom.com/de-de/apps/help-center#!hc-pixoo64-developeropen-sourcesdkapiopen-source |
| Reverse-engineered notes | https://github.com/Grayda/pixoo_api/blob/main/NOTES.md |
| Python `pixoo` library | https://github.com/SomethingWithComputers/pixoo |
| Python `pixoo-rest` wrapper | https://github.com/4ch1m/pixoo-rest |
| Rust `divoom` library + CLI | https://github.com/r12f/divoom |
| Font list JSON | https://app.divoom-gz.com/Device/GetTimeDialFontList |
| Font visual preview | http://dial.divoom-gz.com/dial.php/index.html |

## Scripts

| Script | Description | Run |
|---|---|---|
| `hello-claude.ts` | Static frame: Clawd sprite + "Hello from Claude" text | `bun dist/scripts/hello-claude.js` |
| `hello-claude-animated.ts` | 20-frame animation: bouncing/winking Clawd + text | `bun dist/scripts/hello-claude-animated.js` |
| `demo.ts` | Full toolkit exercise: shapes, gradients, text, animation | `bun dist/scripts/demo.js` |
| `color-test.ts` | 4×4 color calibration chart (16 named swatches) | `bun dist/scripts/color-test.js` |

All scripts: `bun run build && bun dist/scripts/<name>.js`

## Conventions

- **CHANGELOG**: Never use `[Unreleased]` as a version header. Always assign a concrete version number and date.
- All device communication is `POST http://<device-ip>/post` with JSON body
- Check `error_code === 0` for success
- Pixel data is `size × size` (16, 32, or 64), RGB, row-major, base64-encoded
- Use `PicID` to track animation identity; increment for new animations
- Keep frame count under 40 for stability
- Rate-limit pushes to ~1/second to avoid the ~300-push freeze bug

## Maintenance

Keep this file updated when adding scripts, source modules, or discovering new device API behaviors. The Scripts table and Project Structure section should reflect the current state of the repo.
