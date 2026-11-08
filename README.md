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

## Schedule (editable in the app)

The **Schedule** card in the control panel lists time blocks. Each block has days, a
start and end time, and a setting for each route: the L (Manhattan, Brooklyn, or off)
and the B48 (northbound, southbound, or off). Blocks are checked top to bottom, and the
first match wins. Outside every block, the sign shows the L to Manhattan.

The screen layout follows the routes that are on:

| Routes on | Layout |
| --- | --- |
| Both | Two rows |
| One | That route fills the screen |
| None | Blank sign (idle animations still play) |

**Reset to original** restores the rules below.

## What the sign shows

Original rules (the default schedule):

**Weekdays** (New York time)
- **L train:** Brooklyn-bound (BK) from 4–7 PM; Manhattan-bound (MN) at all other times.
- **B48:** Northbound (NB, stop 303825) from 12–7 PM; Southbound (SB, stop 303855) at all other times.
- Two rows: L on top, bus below.

**Weekends:** L train to Manhattan only, filling the whole screen, with the next
train in big digits and the one after in small digits.

**Colors:** amber means live GPS and white means scheduled. "AR" means arriving now,
and "--" means no data.

**Brightness:** daytime 12 and night 5. Night runs 5 PM – 7 AM by default. Change
the levels and the night hours from the control panel.

**Idle cat:** about every 30 seconds a cat strolls along the bottom of the screen.
There are three cats:

| Name | What happens |
| --- | --- |
| Stroll (`walk`) | An orange tabby walks across the bottom of the screen |
| Yarn chase (`chase`) | A ball of yarn rolls by, and the cat sprints after it |
| Peek-a-boo (`peek`) | A cat face rises from the bottom, blinks, and ducks back down |

## Control panel: Headway

**https://us-central1-mta-transit-matrix.cloudfunctions.net/app**

The phone app is called **Headway**, after the transit term for the time between
trains. It has three tabs: **Sign** (live preview, messages, play now), **Animations**
(library, create, idle), and **Settings** (brightness, schedule, sign info).

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
| `GEMINI_API_KEY` | *(Optional)* A Google AI Studio key, which enables "Create with Gemini". Get one at https://aistudio.google.com/apikey |

To use a different Gemini model, add a repository **variable** (not a secret) named
`GEMINI_MODEL`, e.g. `gemini-3.8-flash`, which is the default.

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

## Make your own animations (no AI)

Under **Make your own** in the control panel:

- **Quick animation:** pick a character (walking, running, sitting, sleeping, or
  peeking cat, mouse, bird, butterfly, heart), a motion (across, there and back, hop,
  stop and sit, peek up, stay put), something for it to chase, direction, speed, row,
  and a background (over the arrivals, black, or one of your photos). It's instant and
  free, and uses the same hand-drawn sprites as the built-in cats.
- **Upload image:** choose a photo. It's cropped or fitted to 64×32, dithered for LEDs,
  and shown for 5–15 seconds.

Saved items appear under **Your animations**, where you can play them or add them to
the idle rotation. The sprite library is in `functions/lib/assets.js`.

## Animations from a prompt (Gemini)

In the control panel, describe an animation under **Create with Gemini**, for example
"a cat chases a red laser dot". The steps after that:

1. Gemini choreographs it: it mostly directs the hand-drawn library sprites (so cats
   look as good as the built-in ones), only drawing new sprites for things the library
   doesn't have, and moves them between timed waypoints. The cloud checks and repairs the result,
   asks Gemini to fix it if needed, and saves it.
2. The app shows a live preview. **Play on sign** shows it now; **Idle** adds it to the
   idle rotation, used when the idle cat is set to **Mix** or **Mine**.
3. The sign downloads your animation library whenever it changes (`/anims`). No re-flashing.

The format and the rules Gemini follows are documented in `functions/lib/animations.js`.

## Firmware updates happen by themselves

After the first USB flash, the sign updates itself:

1. Every firmware change merged to `main` is compiled by GitHub Actions and published
   as a release named `fw-<build number>`.
2. Every 10 minutes the sign checks the latest release. If it's newer, the sign shows
   **UPDATING / KEEP POWER**, installs it, and restarts. The firmware version appears
   next to "Online" in the app.
3. If a new build crashes before it has shown arrivals for a minute, the board rolls
   back to the previous version on its next restart.

If you flash from the Arduino IDE, that build is version 0, so the sign upgrades
itself to the latest release a few seconds after starting. Keep the IDE's
**Partition Scheme** on a setting that includes OTA, such as the default.

## Flashing the firmware

1. Copy `firmware/mta_sign/secrets.example.h` to `firmware/mta_sign/secrets.h` and
   fill in your Wi-Fi name and password. `secrets.h` is never uploaded to GitHub.
2. In the Arduino IDE, install the **esp32** board package (by Espressif) and these
   libraries: **ESP32 HUB75 LED MATRIX PANEL DMA Display**, **Adafruit GFX Library**,
   and **ArduinoJson** (version 7).
3. Open `firmware/mta_sign/mta_sign.ino`, select **ESP32S3 Dev Module**, and upload.

You only need to flash by hand once. After that, firmware updates install themselves
(see above), and schedule rules, brightness, messages, and animations all come from the cloud.

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


