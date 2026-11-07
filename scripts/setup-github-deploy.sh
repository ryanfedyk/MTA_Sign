#!/usr/bin/env bash
# One-time setup: creates a Google Cloud service account that GitHub Actions
# uses to deploy the cloud function, and downloads its key.
#
# Run this in Google Cloud Shell (https://shell.cloud.google.com), signed in
# as the owner of the mta-transit-matrix project:
#
#   curl -fsSL https://raw.githubusercontent.com/ryanfedyk/MTA_Sign/main/scripts/setup-github-deploy.sh | bash
#
# Safe to run more than once.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-mta-transit-matrix}"
SA_NAME="github-deployer"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
KEY_FILE="$HOME/github-deployer-key.json"

echo "==> Using project: $PROJECT_ID"
gcloud config set project "$PROJECT_ID" >/dev/null

echo "==> Making sure the required Google APIs are on"
gcloud services enable \
  cloudfunctions.googleapis.com run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com eventarc.googleapis.com \
  cloudresourcemanager.googleapis.com iam.googleapis.com firebase.googleapis.com \
  serviceusage.googleapis.com --quiet

echo "==> Making sure the settings database (Firestore) exists"
gcloud services enable firestore.googleapis.com --quiet
if gcloud firestore databases describe --database="(default)" >/dev/null 2>&1; then
  echo "    already exists"
else
  gcloud firestore databases create --database="(default)" --location=nam5 --type=firestore-native --quiet
fi

echo "==> Creating service account $SA_EMAIL (if it doesn't exist)"
gcloud iam service-accounts describe "$SA_EMAIL" >/dev/null 2>&1 || \
  gcloud iam service-accounts create "$SA_NAME" --display-name="GitHub Actions deployer"

echo "==> Granting deploy permissions"
for ROLE in \
  roles/cloudfunctions.admin \
  roles/run.admin \
  roles/iam.serviceAccountUser \
  roles/artifactregistry.admin \
  roles/cloudbuild.builds.editor \
  roles/serviceusage.serviceUsageConsumer \
  roles/firebase.viewer \
  roles/storage.admin; do
  # A brand-new service account can take up to a minute to be visible to IAM,
  # so retry for a bit instead of failing on the first attempt.
  for ATTEMPT in 1 2 3 4 5 6 7 8 9 10 11 12; do
    if gcloud projects add-iam-policy-binding "$PROJECT_ID" \
        --member="serviceAccount:$SA_EMAIL" --role="$ROLE" --condition=None --quiet >/dev/null 2>&1; then
      echo "    granted $ROLE"
      break
    fi
    if [ "$ATTEMPT" = 12 ]; then
      echo "    FAILED to grant $ROLE — re-run this script in a minute." >&2
      exit 1
    fi
    echo "    waiting for the new account to be ready..."
    sleep 10
  done
done

echo "==> Creating a key file"
rm -f "$KEY_FILE"
gcloud iam service-accounts keys create "$KEY_FILE" --iam-account="$SA_EMAIL"

cat <<MSG

======================================================================
 Done. Next:
   1. Copy the long line of letters/numbers printed between the dashes.
   2. In GitHub: MTA_Sign repo -> Settings -> Secrets and variables ->
      Actions -> GCP_SA_KEY (or New repository secret named GCP_SA_KEY)
         Value: (paste)
   3. Then delete the key from Cloud Shell:  rm $KEY_FILE
======================================================================
MSG
echo "----------------------------------------------------------------------"
base64 -w0 "$KEY_FILE"
echo
echo "----------------------------------------------------------------------"
