// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "WeftMateCore",
    platforms: [.macOS(.v14), .iOS(.v17), .watchOS(.v10)],
    products: [.library(name: "WeftMateCore", targets: ["WeftMateCore"]),
               .executable(name: "AppleAcceptance", targets: ["AppleAcceptance"])],
    targets: [
        .target(name: "WeftMateCore"),
        .executableTarget(name: "AppleAcceptance", dependencies: ["WeftMateCore"]),
        .testTarget(name: "WeftMateCoreTests", dependencies: ["WeftMateCore"])
    ]
)
