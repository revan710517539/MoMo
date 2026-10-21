import AppKit
import Foundation

// Metadata only: no window titles, screenshots, accessibility APIs, key events,
// clipboard, document URLs, UI scripting, or network access.
let app = NSWorkspace.shared.frontmostApplication
let payload: [String: String] = [
    "bundleId": app?.bundleIdentifier ?? "",
    "name": app?.localizedName ?? ""
]
if let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]),
   let text = String(data: data, encoding: .utf8) {
    print(text)
} else {
    print("{\"bundleId\":\"\",\"name\":\"\"}")
}
