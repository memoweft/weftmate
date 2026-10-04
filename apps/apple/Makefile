PROJECT := WeftMate.xcodeproj
DERIVED_DATA ?= Build/DerivedData
PHONE_ID ?= F5A389E4-13FC-41B1-A758-7750883D2022
WATCH_ID ?= 35E9800F-8F39-432C-8F51-03A88309A386

.PHONY: project build-mac build-phone build-watch test-core test-mac test-phone run-mac run-phone run-watch

project:
	python3 Scripts/generate_project.py

build-mac:
	xcodebuild -project $(PROJECT) -scheme WeftMateMac -configuration Debug -destination 'platform=macOS' -derivedDataPath $(DERIVED_DATA) build

build-phone:
	xcodebuild -project $(PROJECT) -scheme WeftMatePhone -configuration Debug -destination 'platform=iOS Simulator,id=$(PHONE_ID)' -derivedDataPath $(DERIVED_DATA) build

build-watch:
	xcodebuild -project $(PROJECT) -scheme WeftMateWatch -configuration Debug -destination 'platform=watchOS Simulator,id=$(WATCH_ID)' -derivedDataPath $(DERIVED_DATA) build

test-core:
	cd Packages/WeftMateCore && swift test

test-mac:
	xcodebuild -project $(PROJECT) -scheme WeftMateMac -configuration Debug -destination 'platform=macOS' -derivedDataPath $(DERIVED_DATA) test

test-phone:
	xcodebuild -project $(PROJECT) -scheme WeftMatePhone -configuration Debug -destination 'platform=iOS Simulator,id=$(PHONE_ID)' -derivedDataPath $(DERIVED_DATA) test

run-mac: build-mac
	open $(DERIVED_DATA)/Build/Products/Debug/WeftMateMac.app

run-phone: build-phone
	Scripts/launch_simulator.sh phone $(PHONE_ID) $(DERIVED_DATA)

run-watch: build-phone build-watch
	Scripts/launch_simulator.sh watch $(WATCH_ID) $(DERIVED_DATA)
