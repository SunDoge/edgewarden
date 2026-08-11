#!/usr/bin/env bash
set -euo pipefail

: "${BW_SERVER:?Set BW_SERVER to the Edgewarden HTTPS origin}"
: "${BW_EMAIL:?Set BW_EMAIL to a disposable compatibility-test account}"
: "${BW_PASSWORD:?Set BW_PASSWORD for the compatibility-test account}"

command -v bw >/dev/null || {
	printf 'bw is required; run this script through mise exec\n' >&2
	exit 1
}

cli_data_dir=$(mktemp -d)
export BITWARDENCLI_APPDATA_DIR="$cli_data_dir"
session=""
folder_id=""
item_id=""

cleanup() {
	if [[ -n "$session" && -n "$item_id" ]]; then
		BW_SESSION="$session" bw delete item "$item_id" --permanent >/dev/null 2>&1 || true
	fi
	if [[ -n "$session" && -n "$folder_id" ]]; then
		BW_SESSION="$session" bw delete folder "$folder_id" >/dev/null 2>&1 || true
	fi
	bw logout >/dev/null 2>&1 || true
	find "$cli_data_dir" -type f -delete
	find "$cli_data_dir" -depth -type d -empty -delete
}
trap cleanup EXIT

bw config server "$BW_SERVER" >/dev/null
session=$(bw login "$BW_EMAIL" --passwordenv BW_PASSWORD --raw)
BW_SESSION="$session" bw sync >/dev/null

folder_name="Edgewarden CLI smoke $(date +%s)"
folder_encoded=$(printf '%s' "{\"name\":\"$folder_name\"}" | bw encode)
folder_json=$(BW_SESSION="$session" bw create folder "$folder_encoded")
folder_id=$(FOLDER_JSON="$folder_json" bun -e 'process.stdout.write(JSON.parse(process.env.FOLDER_JSON).id)')

item_payload=$(FOLDER_ID="$folder_id" bun -e 'process.stdout.write(JSON.stringify({type:1,name:"Edgewarden CLI smoke login",folderId:process.env.FOLDER_ID,favorite:false,reprompt:0,fields:[],login:{username:"smoke-user",password:"smoke-password",uris:[{match:null,uri:"https://example.com"}],totp:null}}))')
item_encoded=$(printf '%s' "$item_payload" | bw encode)
item_json=$(BW_SESSION="$session" bw create item "$item_encoded")
item_id=$(ITEM_JSON="$item_json" bun -e 'process.stdout.write(JSON.parse(process.env.ITEM_JSON).id)')

BW_SESSION="$session" bw sync >/dev/null
item_json=$(BW_SESSION="$session" bw get item "$item_id")
ITEM_JSON="$item_json" bun -e '
	const item = JSON.parse(process.env.ITEM_JSON);
	if (item.name !== "Edgewarden CLI smoke login" || item.login?.username !== "smoke-user") {
		throw new Error("CLI item did not round-trip through sync");
	}
'

BW_SESSION="$session" bw delete item "$item_id" --permanent >/dev/null
item_id=""
BW_SESSION="$session" bw delete folder "$folder_id" >/dev/null
folder_id=""

printf 'Bitwarden CLI login, sync, create, read, and delete smoke test passed.\n'
