import Foundation
import Vision
import CoreVideo
import ImageIO
let a = CommandLine.arguments
if a.count != 4 { fatalError("source target output") }
let target = URL(fileURLWithPath:a[2])
let request = VNGenerateOpticalFlowRequest(targetedImageURL:target, options:[:])
request.computationAccuracy = .veryHigh
request.outputPixelFormat = kCVPixelFormatType_TwoComponent32Float
request.keepNetworkOutput = false
try VNImageRequestHandler(url:URL(fileURLWithPath:a[1])).perform([request])
guard let result = request.results?.first else { fatalError("no flow") }
let p = result.pixelBuffer
CVPixelBufferLockBaseAddress(p, .readOnly)
defer { CVPixelBufferUnlockBaseAddress(p, .readOnly) }
let w=CVPixelBufferGetWidth(p), h=CVPixelBufferGetHeight(p), stride=CVPixelBufferGetBytesPerRow(p)
var data=Data()
for row in 0..<h { data.append(CVPixelBufferGetBaseAddress(p)!.advanced(by:row*stride).assumingMemoryBound(to:UInt8.self),count:w*8) }
try data.write(to:URL(fileURLWithPath:a[3]))
print("\(w) \(h) \(data.count)")
