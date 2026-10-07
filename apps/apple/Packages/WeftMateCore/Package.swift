// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "WeftMateCore",
    platforms: [.macOS(.v14), .iOS(.v17), .watchOS(.v10)],
    products: [.library(name: "WeftMateCore", targets: ["WeftMateCore"]),
               .executable(name: "AppleAcceptance", targets: ["AppleAcceptance"])],
    dependencies: [.package(url: "https://github.com/airsidemobile/JOSESwift.git", exact: "3.0.0")],
    targets: [
        .target(name: "WeftMateCore", dependencies: [.product(name: "JOSESwift", package: "JOSESwift")]),
        .executableTarget(name: "AppleAcceptance", dependencies: ["WeftMateCore"]),
        .testTarget(name: "WeftMateCoreTests", dependencies: ["WeftMateCore"])
    ]
)
