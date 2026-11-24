#!/usr/bin/env bash
# Build and deploy the survey reader (Phase 4).
#
#   scripts/deploy_survey.sh           build the zip and show the Terraform plan
#   scripts/deploy_survey.sh --apply   apply the plan that the last run showed
#
# Nothing in AWS changes without --apply. The model API key is not handled here:
# it lives in an encrypted SSM parameter that a person creates by hand.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TF="$ROOT/terraform/aws"
BUILD="$ROOT/.survey-build"
ZIP="$TF/survey-reader.zip"

if [[ "${1:-}" == "--apply" ]]; then
  [[ -f "$TF/tfplan" ]] || { echo "No plan to apply. Run without --apply first."; exit 1; }
  (cd "$TF" && terraform apply tfplan && rm -f tfplan)
  echo
  echo "Address for the page:  $(cd "$TF" && terraform output -raw read_survey_url)"
  echo "Key for the page:      terraform -chdir=terraform/aws output -raw page_key"
  exit 0
fi

echo "== tests"
(cd "$ROOT/lambda" && python -m unittest test_handler)

echo "== build"
rm -rf "$BUILD" && mkdir -p "$BUILD"
# Wheels for the Lambda runtime (Linux, x86_64, Python 3.14), whatever machine this runs on.
python -m pip install --quiet --target "$BUILD" --requirement "$ROOT/lambda/requirements.txt" \
  --platform manylinux2014_x86_64 --implementation cp --python-version 3.14 --only-binary=:all: --upgrade
cp "$ROOT/lambda/handler.py" "$BUILD/"
find "$BUILD" -name "__pycache__" -type d -prune -exec rm -rf {} +
rm -f "$ZIP"
# sorted names and fixed dates, so the same code gives the same zip and Terraform sees no change
python - "$BUILD" "$ZIP" <<'PY'
import os, sys, zipfile
src, dst = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as z:
    for d, _, fs in sorted(os.walk(src)):
        for f in sorted(fs):
            p = os.path.join(d, f)
            info = zipfile.ZipInfo(os.path.relpath(p, src).replace(os.sep, "/"), (2020, 1, 1, 0, 0, 0))
            info.external_attr = 0o644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, open(p, "rb").read())
print(dst, round(os.path.getsize(dst) / 1e6, 1), "MB")
PY

echo "== plan"
cd "$TF"
terraform init -input=false >/dev/null
terraform plan -input=false -var-file=prod.tfvars -out=tfplan
echo
echo "Nothing has changed yet. To apply this plan:  scripts/deploy_survey.sh --apply"
