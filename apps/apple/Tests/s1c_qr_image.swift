import Foundation
import CoreImage
import ImageIO
import UniformTypeIdentifiers
// Only invoked by the isolated fixture; stdin carries a synthetic pairing response.
let bytes = FileHandle.standardInput.readDataToEndOfFile()
let filter = CIFilter(name: "CIQRCodeGenerator")!
filter.setValue(bytes, forKey: "inputMessage")
filter.setValue("M", forKey: "inputCorrectionLevel")
let code = filter.outputImage!.transformed(by: CGAffineTransform(scaleX: 5, y: 5))
let white = CIImage(color: .white).cropped(to: code.extent.insetBy(dx: -20, dy: -20))
let image = code.composited(over: white)
let context = CIContext()
let cg = context.createCGImage(image, from: image.extent)!
let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath: CommandLine.arguments[1]) as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(destination, cg, nil)
precondition(CGImageDestinationFinalize(destination))
