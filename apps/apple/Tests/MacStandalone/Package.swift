// swift-tools-version: 6.0
import PackageDescription

// Compile the exact shared product controller, with isolated account/credential dependencies.
let package = Package(
    name: "MacStandaloneChecks",
    platforms: [.macOS(.v14)],
    dependencies: [.package(path: "../../Packages/WeftMateCore")],
    targets: [
        .target(name: "MacStandaloneProduct", dependencies: [.product(name: "WeftMateCore", package: "WeftMateCore")], path: "Product"),
        .testTarget(name: "MacStandaloneTests", dependencies: ["MacStandaloneProduct", .product(name: "WeftMateCore", package: "WeftMateCore")], path: "Tests")
    ]
)
