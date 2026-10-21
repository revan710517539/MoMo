import Foundation
import Vision
import CoreImage
import ImageIO
import UniformTypeIdentifiers

// Local Apple Vision instance segmentation only. No network or model downloads.
let args = CommandLine.arguments
if args.count != 3 { fputs("Usage: prepare-rabbit-video-mask input-dir mask-dir\n", stderr); exit(2) }
let input = URL(fileURLWithPath: args[1], isDirectory: true)
let output = URL(fileURLWithPath: args[2], isDirectory: true)
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
let files = try FileManager.default.contentsOfDirectory(at: input, includingPropertiesForKeys: nil).filter { $0.pathExtension == "png" }.sorted { $0.lastPathComponent < $1.lastPathComponent }
let context = CIContext(options: [.cacheIntermediates: false])
for (index, file) in files.enumerated() {
  try autoreleasepool {
    let handler = VNImageRequestHandler(url: file)
    let request = VNGenerateForegroundInstanceMaskRequest()
    try handler.perform([request])
    guard let result = request.results?.first, !result.allInstances.isEmpty else { throw NSError(domain: "RabbitMask", code: 1, userInfo: [NSLocalizedDescriptionKey: "No foreground in \(file.lastPathComponent)"]) }
    let buffer = try result.generateScaledMaskForImage(forInstances: result.allInstances, from: handler)
    let mask = CIImage(cvPixelBuffer: buffer)
    let url = output.appendingPathComponent(file.lastPathComponent)
    try context.writePNGRepresentation(of: mask, to: url, format: .L8, colorSpace: CGColorSpaceCreateDeviceGray(), options: [:])
  }
  if index % 12 == 0 || index == files.count - 1 { print("mask \(index+1)/\(files.count)"); fflush(stdout) }
}
