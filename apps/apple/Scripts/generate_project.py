#!/usr/bin/env python3
"""Rebuild the checked-in Xcode project using stdlib and local source files only."""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT / "WeftMate.xcodeproj"
OBJECTS = {}

def ident(name):
    return hashlib.sha256(name.encode()).hexdigest()[:24].upper()

def ref(name):
    return ident(name)

def obj(object_name, **fields):
    key = ident(object_name)
    OBJECTS[key] = fields
    return key

def encode(value):
    if isinstance(value, dict):
        return "{ " + " ".join(f"{json.dumps(k, ensure_ascii=False)} = {encode(v)};" for k,v in value.items()) + " }"
    if isinstance(value, list):
        return "(" + ", ".join(encode(v) for v in value) + ("," if value else "") + ")"
    if isinstance(value, int):
        return str(value)
    # Plain IDs are references. All other strings are quoted for paths/settings.
    if len(value) == 24 and all(c in "0123456789ABCDEF" for c in value):
        return value
    return json.dumps(value, ensure_ascii=False)

base_config = obj("file:Config/Base.xcconfig", isa="PBXFileReference", lastKnownFileType="text.xcconfig", path="Config/Base.xcconfig", sourceTree="SOURCE_ROOT")
all_files = [base_config]

def file(path, kind="sourcecode.swift"):
    result = obj("file:" + path, isa="PBXFileReference", lastKnownFileType=kind, path=path, sourceTree="SOURCE_ROOT")
    if result not in all_files:
        all_files.append(result)
    return result

package = obj("package", isa="XCLocalSwiftPackageReference", relativePath="Packages/WeftMateCore")
products = []
targets = []
target_attrs = {}

def configs(name, settings, is_project=False):
    ids = []
    for config in ["Debug", "Release"]:
        build = dict(settings)
        if config == "Debug":
            build.update(SWIFT_OPTIMIZATION_LEVEL="-Onone", DEBUG_INFORMATION_FORMAT="dwarf", SWIFT_ACTIVE_COMPILATION_CONDITIONS="$(inherited) DEBUG", ENABLE_TESTABILITY="YES", ONLY_ACTIVE_ARCH="YES")
            if name == "WeftMatePhone":
                build["INFOPLIST_FILE"] = "Config/SimulatorTestInfo.plist"
                build["INFOPLIST_KEY_NSHealthUpdateUsageDescription"] = "仅在隔离模拟器 XCTest 中写入合成样本，日用功能不写健康数据。"
        else:
            build.update(SWIFT_OPTIMIZATION_LEVEL="-O", DEBUG_INFORMATION_FORMAT="dwarf-with-dsym", ONLY_ACTIVE_ARCH="NO")
        fields = dict(isa="XCBuildConfiguration", buildSettings=build, name=config)
        if not is_project:
            fields["baseConfigurationReference"] = base_config
        ids.append(obj(name + ":config:" + config, **fields))
    return obj(name + ":config-list", isa="XCConfigurationList", buildConfigurations=ids, defaultConfigurationIsVisible=0, defaultConfigurationName="Release")

def dependency(parent, child):
    proxy = obj(parent + ":proxy:" + child, isa="PBXContainerItemProxy", containerPortal=ref("project"), proxyType=1, remoteGlobalIDString=ref("target:" + child), remoteInfo=child)
    return obj(parent + ":dependency:" + child, isa="PBXTargetDependency", target=ref("target:" + child), targetProxy=proxy)

def target(name, platform, sources, testing=None):
    is_test = testing is not None
    ext = "xctest" if is_test else "app"
    product = obj("product:" + name, isa="PBXFileReference", explicitFileType="wrapper.cfbundle" if is_test else "wrapper.application", includeInIndex=0, path=name + "." + ext, sourceTree="BUILT_PRODUCTS_DIR")
    products.append(product)
    source_files = [obj(name + ":build:" + path, isa="PBXBuildFile", fileRef=file(path)) for path in sources]
    phases = [obj(name + ":sources", isa="PBXSourcesBuildPhase", buildActionMask=2147483647, files=source_files, runOnlyForDeploymentPostprocessing=0)]
    packages = []
    framework_files = []
    if not is_test:
        core = obj(name + ":core", isa="XCSwiftPackageProductDependency", package=package, productName="WeftMateCore")
        packages.append(core)
        framework_files.append(obj(name + ":framework:core", isa="PBXBuildFile", productRef=core))
    phases.append(obj(name + ":frameworks", isa="PBXFrameworksBuildPhase", buildActionMask=2147483647, files=framework_files, runOnlyForDeploymentPostprocessing=0))
    resource_files = []
    if not is_test:
        for catalog in ["Resources/Spirit.xcassets", "Resources/Icons.xcassets",
                        "Resources/" + {"macosx": "Mac", "iphoneos": "Phone", "watchos": "Watch"}[platform] + "Icons.xcassets"]:
            resource_files.append(obj(name + ":resource:" + catalog, isa="PBXBuildFile",
                                      fileRef=file(catalog, "folder.assetcatalog")))
    if not is_test and platform in ["macosx", "iphoneos"]:
        for document in ["terms-zh", "privacy-zh"]:
            path = "../../docs/legal/" + document + ".md"
            resource_files.append(obj(name + ":legal:" + document, isa="PBXBuildFile", fileRef=file(path, "net.daringfireball.markdown")))
    phases.append(obj(name + ":resources", isa="PBXResourcesBuildPhase", buildActionMask=2147483647,
                      files=resource_files, runOnlyForDeploymentPostprocessing=0))
    deps = []
    if name == "WeftMatePhone":
        embed = obj(name + ":watch-embed-build", isa="PBXBuildFile", fileRef=ref("product:WeftMateWatch"), settings={"ATTRIBUTES": ["RemoveHeadersOnCopy"]})
        phases.append(obj(name + ":watch-embed", isa="PBXCopyFilesBuildPhase", buildActionMask=2147483647, dstPath="$(CONTENTS_FOLDER_PATH)/Watch", dstSubfolderSpec=16, files=[embed], name="Embed Watch Content", runOnlyForDeploymentPostprocessing=0))
        deps.append(dependency(name, "WeftMateWatch"))
    if is_test:
        deps.append(dependency(name, testing))
    settings = {"PRODUCT_NAME": "$(TARGET_NAME)", "PRODUCT_BUNDLE_IDENTIFIER": "com.weftmate.apple." + name.lower(), "SDKROOT": platform}
    if not is_test:
        settings["ASSETCATALOG_COMPILER_APPICON_NAME"] = "AppIcon"
    if platform == "macosx":
        settings.update(MACOSX_DEPLOYMENT_TARGET="14.0", SUPPORTED_PLATFORMS="macosx", COMBINE_HIDPI_IMAGES="YES")
        if not is_test:
            settings["CODE_SIGN_ENTITLEMENTS"] = "Config/WeftMateMac.entitlements"
    if not is_test and platform in ["macosx", "iphoneos"]:
        settings["INFOPLIST_FILE"] = "Config/MacInfo.plist" if platform == "macosx" else "Config/NativeInfo.plist"
    if platform == "iphoneos":
        settings.update(IPHONEOS_DEPLOYMENT_TARGET="17.0", SUPPORTED_PLATFORMS="iphoneos iphonesimulator", TARGETED_DEVICE_FAMILY="1,2", SUPPORTS_MACCATALYST="NO", INFOPLIST_KEY_UILaunchScreen_Generation="YES", INFOPLIST_KEY_UIApplicationSceneManifest_Generation="YES", INFOPLIST_KEY_UIApplicationSupportsIndirectInputEvents="YES")
    elif platform == "watchos":
        settings.update(WATCHOS_DEPLOYMENT_TARGET="10.0", SUPPORTED_PLATFORMS="watchos watchsimulator", TARGETED_DEVICE_FAMILY="4", SKIP_INSTALL="YES")
        if not is_test:
            settings["PRODUCT_BUNDLE_IDENTIFIER"] = "com.weftmate.apple.weftmatephone.watch"
            settings.update(INFOPLIST_KEY_WKApplication="YES", INFOPLIST_KEY_WKCompanionAppBundleIdentifier="com.weftmate.apple.weftmatephone", INFOPLIST_KEY_WKRunsIndependentlyOfCompanionApp="NO")
    if is_test:
        settings.update(TEST_TARGET_NAME=testing, INFOPLIST_KEY_CFBundleDisplayName=name)
    elif platform in ["macosx", "iphoneos"]:
        if platform == "iphoneos":
            settings["INFOPLIST_KEY_NSCameraUsageDescription"] = "拍摄你选择的图片作为对话附件，或扫描电脑上的一次性配对二维码。"
        settings["INFOPLIST_KEY_NSLocalNetworkUsageDescription"] = "WeftMate 连接你选择的个人服务器，以便同步账户和会话。"
    if not is_test and platform in ["iphoneos", "watchos"]:
        settings["CODE_SIGN_ENTITLEMENTS"] = "Config/WeftMateHealth.entitlements"
        settings["INFOPLIST_KEY_NSHealthShareUsageDescription"] = "WeftMate 只读取你选择的健康项目，在设备上汇总每日摘要，用于个人陪伴。"
    cfg = configs(name, settings)
    tid = obj("target:" + name, isa="PBXNativeTarget", buildConfigurationList=cfg, buildPhases=phases, buildRules=[], dependencies=deps, name=name, packageProductDependencies=packages, productName=name, productReference=product, productType="com.apple.product-type.bundle.ui-testing" if is_test else "com.apple.product-type.application")
    targets.append(tid)
    target_attrs[tid] = {"CreatedOnToolsVersion": "26.3"}
    if is_test:
        target_attrs[tid]["TestTargetID"] = ref("target:" + testing)
    return tid

ui = sorted(str(p.relative_to(ROOT)) for p in (ROOT / "UI").rglob("*.swift"))
mac = sorted(str(p.relative_to(ROOT)) for p in (ROOT / "macOS").rglob("*.swift"))
phone = sorted(str(p.relative_to(ROOT)) for p in (ROOT / "iOS").rglob("*.swift"))
watch = sorted(str(p.relative_to(ROOT)) for p in (ROOT / "watchOS").rglob("*.swift"))
target("WeftMateWatch", "watchos", watch + ["UI/WeftIcon.swift", "../../design/tokens/generated/apple/DesignTokens.swift"])
debug_fixture = ["Tests/TaskProgressUIFixture.swift", "Tests/AppleContractUIFixture.swift", "Tests/HealthKitUIFixture.swift"]
target("WeftMateMac", "macosx", ui + mac + debug_fixture + ["../../design/tokens/generated/apple/DesignTokens.swift"])
target("WeftMatePhone", "iphoneos", ui + phone + debug_fixture + ["../../design/tokens/generated/apple/DesignTokens.swift"])
target("WeftMateMacUITests", "macosx", ["Tests/A16ChatUITests.swift", "Tests/A15UXUITests.swift", "Tests/UPD2UITests.swift", "Tests/WeftMateUITests.swift", "Tests/A4aApprovalUITests.swift", "Tests/A4bResourcesUITests.swift"], "WeftMateMac")
target("WeftMatePhoneUITests", "iphoneos", ["Tests/A16ChatUITests.swift", "Tests/A15UXUITests.swift", "Tests/A14OfflineUITests.swift", "Tests/A13ConsistencyUITests.swift", "Tests/A11ProjectsUITests.swift", "Tests/A9PolishUITests.swift", "Tests/A8ConversationFlowUITests.swift", "Tests/UPD2UITests.swift", "Tests/A7SessionMenuUITests.swift", "Tests/A6SettingsUITests.swift", "Tests/A5ParityUITests.swift", "Tests/LG2AccountUITests.swift", "Tests/WeftMateUITests.swift", "Tests/IC2IconsUITests.swift", "Tests/A4cAppearanceUITests.swift", "Tests/A3TimelineUITests.swift", "Tests/S1cCloudUITests.swift", "Tests/A4aApprovalUITests.swift", "Tests/A4bResourcesUITests.swift"], "WeftMatePhone")
target("WeftMateWatchUITests", "watchos", ["Tests/A16WatchUITests.swift", "Tests/A13WatchUITests.swift", "Tests/IC2WatchIconsUITests.swift", "Tests/A12WatchLiveUITests.swift"], "WeftMateWatch")
product_group = obj("products", isa="PBXGroup", children=products, name="Products", sourceTree="<group>")
group = obj("group", isa="PBXGroup", children=all_files+[product_group], sourceTree="<group>")
project_config = configs("project", {"CLANG_WARN_DOCUMENTATION_COMMENTS": "YES", "CLANG_WARN_UNGUARDED_AVAILABILITY": "YES_AGGRESSIVE", "SWIFT_VERSION": "6.0"}, True)
obj("project", isa="PBXProject", attributes={"BuildIndependentTargetsInParallel": "YES", "LastSwiftUpdateCheck": "2630", "LastUpgradeCheck": "2630", "TargetAttributes": target_attrs}, buildConfigurationList=project_config, compatibilityVersion="Xcode 14.0", developmentRegion="zh-Hans", knownRegions=["zh-Hans", "en", "Base"], mainGroup=group, packageReferences=[package], productRefGroup=product_group, projectDirPath="", projectRoot="", targets=targets)
PROJECT.mkdir(exist_ok=True)
data = "// !$*UTF8*$!\n{\n\tarchiveVersion = 1;\n\tclasses = {};\n\tobjectVersion = 56;\n\tobjects = {\n"
for key, fields in OBJECTS.items():
    data += "\t\t" + key + " = " + encode(fields) + ";\n"
data += "\t};\n\trootObject = " + ref("project") + ";\n}\n"
(PROJECT / "project.pbxproj").write_text(data)
schemes = PROJECT / "xcshareddata/xcschemes"
schemes.mkdir(parents=True, exist_ok=True)
for name in ["WeftMateMac", "WeftMatePhone", "WeftMateWatch"]:
    test = name + "UITests"
    def buildable(target_name, extension="app"):
        return f'<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{ref("target:"+target_name)}" BuildableName="{target_name}.{extension}" BlueprintName="{target_name}" ReferencedContainer="container:WeftMate.xcodeproj"/>'
    test_xml = f'<Testables><TestableReference skipped="NO">{buildable(test, "xctest")}</TestableReference></Testables>' if test else "<Testables/>"
    xml = f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="2630" version="1.3">
 <BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">{buildable(name)}</BuildActionEntry></BuildActionEntries></BuildAction>
 <TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES">{test_xml}</TestAction>
 <LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">{buildable(name)}</BuildableProductRunnable></LaunchAction>
 <ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">{buildable(name)}</BuildableProductRunnable></ProfileAction>
 <AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>'''
    (schemes / (name + ".xcscheme")).write_text(xml)
print("Generated WeftMate.xcodeproj with", len(ui), "shared UI sources and three native app targets.")
