# MTA Sign

A 64×32 LED matrix behind wood veneer that shows live arrivals for the **L train
(Lorimer St)** and the **B48 bus**. Between arrivals, a pixel cat wanders by. You can
send messages and change settings from your phone.

```
MTA feeds ──► Firebase cloud functions ──► ESP32-S3 LED matrix
              /transit  arrivals (every 30 s)
              /sign     settings + commands (every 5 s)
              /app      phone control panel  ◄── you
```

| Folder | What it is |
| --- | --- |
| `functions/` | Cloud code: schedule rules, MTA feed merging, settings, and the web app |
| `firmware/mta_sign/` | Arduino sketch for the Waveshare ESP32-S3-RGB-Matrix |
| `tools/sim/` | Preview tool that renders the sign's real drawing code to GIFs |
| `.github/workflows/` | Automatic tests, firmware builds, and cloud deploys |

## What the sign shows

**Weekdays** (New York time)
- **L train:** Brooklyn-bound (BK) from 4–7 PM; Manhattan-bound (MN) at all other times.
- **B48:** Northbound (NB, stop 303825) from 12–7 PM; Southbound (SB, stop 303855) at all other times.
- Two rows: L on top, bus below.

**Weekends:** L train to Manhattan only, filling the whole screen, with the next
train in big digits and the one after in small digits.

**Colors:** amber means live GPS and white means scheduled. "AR" means arriving now,
and "--" means no data.

**Brightness:** daytime 12 and night (10 PM – 7 AM) 5, both a little dimmer than
before. Change them from the control panel.

**Idle cat:** about every 30 seconds a cat strolls along the bottom of the screen.
There are three cats:

| Name | What happens |
| --- | --- |
| Stroll (`walk`) | An orange tabby walks across the bottom of the screen |
| Yarn chase (`chase`) | A ball of yarn rolls by, and the cat sprints after it |
| Peek-a-boo (`peek`) | A cat face rises from the bottom, blinks, and ducks back down |

## Control panel

**https://us-central1-mta-transit-matrix.cloudfunctions.net/app**

Open it on your phone. In Safari you can tap Share → "Add to Home Screen" to make it feel like an app.
From the panel you can:

- see what's on the sign right now, and whether the sign is online
- send a message that scrolls across the sign (up to 80 characters, 1–5 times)
- play any cat animation immediately
- turn the idle cat on or off, and choose how often it appears and which cat
- set daytime and night brightness

The panel is protected by a passphrase, stored as the `SIGN_APP_PIN` GitHub secret.

## How deploys work

| You do this | GitHub does this |
| --- | --- |
| Open a pull request | Runs the cloud tests and compiles the firmware (no deploy) |
| Merge into `main` | Runs the tests, deploys to Firebase, then checks that all three live URLs respond |
| Actions tab → "Test & deploy cloud function" → **Run workflow** | Same as merging, on demand |

Every firmware build also produces:
- **mta_sign-firmware**: the compiled firmware file
- **screen-previews**: GIFs of every screen and animation

Find both on the run's page in the Actions tab.

## One-time setup

The repo is public, so passwords and keys are stored as **GitHub secrets**
(Settings → Secrets and variables → Actions → New repository secret):

| Secret | What to put in it |
| --- | --- |
| `MTA_BUS_KEY` | Your MTA Bus Time API key |
| `GCP_SA_KEY` | The text printed by the Cloud Shell setup script (below) |
| `SIGN_APP_PIN` | A passphrase for the control panel. A few words is best, e.g. `purple cat window` |

**Cloud Shell setup script.** This creates the account GitHub uses to deploy, and the
settings database. It's safe to run again. Open https://shell.cloud.google.com, signed
in as the owner of the `mta-transit-matrix` project, and paste:

```bash
curl -fsSL https://raw.githubusercontent.com/ryanfedyk/MTA_Sign/main/scripts/setup-github-deploy.sh | bash
```

At the end, the script prints one long line of letters and numbers between two dashed
lines. Copy that into the `GCP_SA_KEY` secret. Line breaks picked up while copying are fine.
Then delete the local copy:

```bash
rm ~/github-deployer-key.json
```

**Settings database only.** If you've already done the setup above and only need the
database, run this in Cloud Shell:

```bash
gcloud services enable firestore.googleapis.com --project mta-transit-matrix && gcloud firestore databases create --database="(default)" --location=nam5 --project mta-transit-matrix
```

## Troubleshooting

- **Sign stuck on CONNECTING:** read the amber line underneath. **NO WIFI** or
  **WIFI PASS?** mean the Wi-Fi name or password in `secrets.h` is wrong (edit
  `secrets.h`, not `secrets.example.h`). **ERR** plus a number means the cloud
  request failed.
- **Control panel not affecting the sign:** first reload the page. If that doesn't help,
  go to the Actions tab and run **Check sign health**. It shows what the sign receives,
  whether the passphrase works, and when the sign last checked in. Tick "send a test cat"
  to test the whole path end to end.

## Flashing the firmware

1. Copy `firmware/mta_sign/secrets.example.h` to `firmware/mta_sign/secrets.h` and
   fill in your Wi-Fi name and password. `secrets.h` is never uploaded to GitHub.
2. In the Arduino IDE, install the **esp32** board package (by Espressif) and these
   libraries: **ESP32 HUB75 LED MATRIX PANEL DMA Display**, **Adafruit GFX Library**,
   and **ArduinoJson** (version 7).
3. Open `firmware/mta_sign/mta_sign.ino`, select **ESP32S3 Dev Module**, and upload.

You only need to re-flash the sign when files in `firmware/` change. Schedule rules,
brightness, messages, and animation triggers all come from the cloud.

## API reference

`GET /transit` (polled by the sign every 30 s):

```json
{ "lay": "LB",
  "l": { "dir": "MN", "t1": 2, "t2": 7 },
  "b": { "dir": "SB", "t1": 14, "live1": true, "t2": 32, "live2": false } }
```

`lay` is `"LB"` for the two-row layout and `"L"` for the full-screen weekend layout
(the bus fields are then blank).

Test parameters:
- `?dir=NB` / `?dir=SB` force a bus direction.
- `?at=2026-11-08T10:00:00-05:00` shows which schedule would apply at another time.
- `?debug=1` adds diagnostics.

`GET /sign` (polled by the sign every 5 s):

```json
{ "bd": 12, "bn": 5, "ie": 30, "is": "walk",
  "a": { "i": 4, "n": "chase" },
  "m": { "i": 2, "t": "Dinner's ready!", "r": 2 } }
```

- `bd` / `bn`: day and night brightness.
- `ie`: seconds between idle cats (0 = off).
- `is`: which idle cat (`walk`, `chase`, `peek`, or `mix`).
- `a`: an animation request; present for 60 s after you press Play.
- `m`: a message; present for 5 min after you press Send.
- `i`: an id that goes up with each request, so the sign plays each one exactly once.

## Developing

```bash
cd functions && npm ci && npm test        # cloud tests
```

```bash
tools/sim/build_previews.sh previews      # GIF previews of every screen (needs g++, python3 + Pillow)
```

### Ideas for later

- **Custom or AI-generated cats:** each sprite is a grid of letters, where each letter
  is one color (see `display.cpp`). The next step is to store sprites in the settings
  database and send them to the sign through `/sign`, so new cats, including ones
  generated by Gemini, can be added without re-flashing.
- Turning routes on and off, and editing the schedule from the control panel.
