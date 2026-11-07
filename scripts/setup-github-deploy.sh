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
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$SA_EMAIL" --role="$ROLE" --condition=None --quiet >/dev/null
  echo "    granted $ROLE"
done

echo "==> Creating a key file"
rm -f "$KEY_FILE"
gcloud iam service-accounts keys create "$KEY_FILE" --iam-account="$SA_EMAIL"

cat <<MSG

======================================================================
 Done. Next:
   1. Copy EVERYTHING printed between the lines below (including { and }).
   2. In GitHub: MTA_Sign repo -> Settings -> Secrets and variables ->
      Actions -> New repository secret
         Name:  GCP_SA_KEY
         Value: (paste)
   3. Then delete the key from Cloud Shell:  rm $KEY_FILE
======================================================================
MSG
echo "----------------------------------------------------------------------"
cat "$KEY_FILE"
echo
echo "----------------------------------------------------------------------"
