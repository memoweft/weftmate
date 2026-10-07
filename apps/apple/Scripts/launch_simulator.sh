#!/bin/sh
set -eu
platform=${1:?Usage: launch_simulator.sh phone|watch DEVICE_ID DERIVED_DATA}
device_id=${2:?A simulator device UUID is required}
derived_data=${3:-Build/DerivedData}
case "$platform" in
  phone) product="Debug-iphonesimulator/WeftMatePhone.app"; bundle="com.weftmate.apple.weftmatephone" ;;
  watch)
    product="Debug-watchsimulator/WeftMateWatch.app"
    bundle="com.weftmate.apple.weftmatephone.watch"
    paired_phone=$(python3 - "$device_id" <<'PY'
import json, subprocess, sys
payload = json.loads(subprocess.run(["xcrun", "simctl", "list", "pairs", "--json"], capture_output=True, text=True, check=True).stdout)
for pair in payload.get("pairs", {}).values():
    if pair.get("watch", {}).get("udid") == sys.argv[1]:
        print(pair["phone"]["udid"])
        break
else:
    raise SystemExit("This companion Watch simulator needs an existing paired iPhone in Xcode.")
PY
    )
    xcrun simctl bootstatus "$paired_phone" -b
    xcrun simctl install "$paired_phone" "$derived_data/Build/Products/Debug-iphonesimulator/WeftMatePhone.app"
    ;;
  *) echo "Choose phone or watch" >&2; exit 2 ;;
esac
# bootstatus accepts an already booted simulator, preserving other devices.
xcrun simctl bootstatus "$device_id" -b
xcrun simctl install "$device_id" "$derived_data/Build/Products/$product"
xcrun simctl launch "$device_id" "$bundle"
