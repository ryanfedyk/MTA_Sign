# MTA Sign

A 64×32 LED matrix behind wood veneer that shows live arrivals for the **L train
(Lorimer St)** and the **B48 bus**.

```
MTA feeds ──► Firebase cloud function "transit" ──► ESP32-S3 LED matrix
              (functions/)                          (firmware/mta_sign/)
```

- **`functions/`** is the cloud proxy. It fetches the MTA feeds, decides which
  direction and stop to show for the time of day, merges live GPS with scheduled
  trips, and returns a tiny JSON payload.
  Live at: https://us-central1-mta-transit-matrix.cloudfunctions.net/transit
- **`firmware/mta_sign/`** is the Arduino sketch for the Waveshare ESP32-S3-RGB-Matrix.
  It polls the proxy every 30 seconds and draws the screen.
- **`.github/workflows/deploy-functions.yml`** tests the cloud function and
  deploys it automatically.

## How deploys work

| You do this | GitHub does this |
| --- | --- |
| Open a pull request | Runs the offline tests (no deploy) |
| Merge into `main` | Runs the tests, deploys to Firebase, then calls the live URL to confirm it works |
| Actions tab → "Test & deploy cloud function" → **Run workflow** | Same as merging, on demand |

Progress and logs for each run are on the repo's **Actions** tab. A failed run
sends you a GitHub email.

## One-time setup (about 5 minutes)

The repo is public, so passwords and keys are stored as **GitHub secrets**, not in the code.
You need to add two secrets.

### 1. `MTA_BUS_KEY` (your MTA Bus Time API key)

GitHub → this repo → **Settings → Secrets and variables → Actions → New repository secret**

- Name: `MTA_BUS_KEY`
- Value: your Bus Time key (the one listed in the handoff doc)

### 2. `GCP_SA_KEY` (permission for GitHub to deploy to your Google Cloud project)

1. Open **Google Cloud Shell**: https://shell.cloud.google.com. Sign in with the
   Google account that owns the `mta-transit-matrix` Firebase project.
2. Paste this command and press Enter:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/ryanfedyk/MTA_Sign/main/scripts/setup-github-deploy.sh | bash
   ```
   (If the code isn't on `main` yet, swap `main` for the branch name.)
3. The script ends by printing one long line of letters and numbers between two
   dashed lines. Copy all of it. Line breaks picked up while copying are fine.
4. Add it as a repository secret named `GCP_SA_KEY`, the same way as step 1.
5. Back in Cloud Shell, delete the local copy:
   ```bash
   rm ~/github-deployer-key.json
   ```

### 3. First deploy

Go to the **Actions** tab, choose **Test & deploy cloud function**, and click
**Run workflow** on `main`. When it turns green, the live endpoint is serving
the code from GitHub.

## Flashing the firmware

1. Copy `firmware/mta_sign/secrets.example.h` to `firmware/mta_sign/secrets.h` and
   fill in your Wi-Fi name and password. `secrets.h` is never uploaded to GitHub.
2. Open `firmware/mta_sign/mta_sign.ino` in the Arduino IDE. You need these libraries:
   *ESP32-HUB75-MatrixPanel-I2S-DMA*, *ArduinoJson* (v6 or v7), and the ESP32 board package.
3. Select the ESP32-S3 board and upload.

## API reference

`GET /transit` returns:

```json
{ "l": { "dir": "MN", "t1": 2, "t2": 7 },
  "b": { "dir": "SB", "t1": 14, "live1": true, "t2": 32, "live2": false } }
```

`t1`/`t2` are minutes to the next two arrivals. `-1` means no data, and `0` means
arriving (shown as "AR"). `live` is true when the bus has GPS tracking (amber on the sign);
otherwise the time comes from the schedule (white).

Test parameters: `?dir=NB` / `?dir=SB` force the B48 direction, and `?debug=1` adds diagnostics.

### Current schedule rules (Eastern Time)

- **L train:** Brooklyn-bound (BK) on weekdays from 4–7 PM; Manhattan-bound (MN) at all other times.
- **B48:** Northbound (NB, stop 303825) from 12–7 PM; Southbound (SB, stop 303855) at all other times.

## Running the tests locally

```bash
cd functions && npm ci && npm test
```
