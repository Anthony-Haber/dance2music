import AppKit
import SwiftUI

@MainActor
final class Launcher: ObservableObject {
    @Published var status = "Checking this Mac…"
    @Published var detail = ""
    @Published var progress: Double = 0
    @Published var bytes = ""
    @Published var ready = false
    @Published var busy = false
    @Published var needsChrome = false
    private var process: Process?
    private var pipe: Pipe?
    private var log: FileHandle?
    private var buffer = Data()
    private var opened = false
    private var stopping = false
    private var sawError = false
    private var runID = UUID()
    private let logs = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/Dance2Music")

    var chrome: URL? { NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.google.Chrome") }

    func start(repair: Bool = false) {
        guard process == nil else { return }
        busy = false
        #if !arch(arm64)
        status = "Apple Silicon is required."
        return
        #endif
        guard ProcessInfo.processInfo.operatingSystemVersion.majorVersion >= 14 else {
            status = "macOS 14 or later is required."; return
        }
        needsChrome = chrome == nil
        guard !needsChrome else {
            status = "Install Google Chrome, then choose Retry."
            detail = "Dance2Music uses your existing Chrome installation for camera and music."
            return
        }
        do {
            try FileManager.default.createDirectory(at: logs, withIntermediateDirectories: true)
            let latest = logs.appendingPathComponent("launcher.log")
            let previous = logs.appendingPathComponent("launcher.previous.log")
            if FileManager.default.fileExists(atPath: latest.path) {
                try? FileManager.default.removeItem(at: previous)
                try FileManager.default.moveItem(at: latest, to: previous)
            }
            FileManager.default.createFile(atPath: latest.path, contents: nil)
            log = try FileHandle(forWritingTo: latest)
            guard let resources = Bundle.main.resourceURL else { throw CocoaError(.fileNoSuchFile) }
            let task = Process(), output = Pipe()
            task.executableURL = resources.deletingLastPathComponent().appendingPathComponent("Helpers/backend/dance2music-backend")
            task.arguments = ["--resources", resources.path, "--parent-pid", String(ProcessInfo.processInfo.processIdentifier)] + (repair ? ["--repair"] : [])
            // Do not inherit Python, dyld, or developer tool search paths.
            task.environment = ["HOME": FileManager.default.homeDirectoryForCurrentUser.path,
                                "PATH": "/usr/bin:/bin:/usr/sbin:/sbin", "LANG": "en_US.UTF-8",
                                "TMPDIR": NSTemporaryDirectory()]
            task.standardOutput = output; task.standardError = log
            task.standardInput = FileHandle.nullDevice
            runID = UUID()
            let currentRun = runID
            buffer.removeAll(); opened = false; ready = false; stopping = false; sawError = false
            busy = true; progress = 0; bytes = ""; status = "Checking installed assets…"; detail = "First setup needs internet. Verified assets are reused."
            output.fileHandleForReading.readabilityHandler = { [weak self] handle in
                let data = handle.availableData
                if data.isEmpty { handle.readabilityHandler = nil }
                Task { @MainActor in self?.consume(data, run: currentRun) }
            }
            task.terminationHandler = { [weak self] finished in
                Task { @MainActor in
                    guard let self, self.runID == currentRun else { return }
                    self.pipe?.fileHandleForReading.readabilityHandler = nil
                    self.pipe = nil; self.process = nil; self.busy = false; self.ready = false
                    try? self.log?.close(); self.log = nil
                    if !self.stopping && !self.sawError {
                        self.status = "The local service stopped (\(finished.terminationStatus)). Choose Retry."
                        self.detail = "Diagnostic logs are in Library/Logs/Dance2Music."
                    }
                }
            }
            process = task; pipe = output
            try task.run()
        } catch {
            pipe?.fileHandleForReading.readabilityHandler = nil; pipe = nil
            try? log?.close(); log = nil
            process = nil; busy = false; status = "Could not start Dance2Music: \(error.localizedDescription)"
        }
    }

    private func consume(_ data: Data, run: UUID) {
        guard runID == run && !stopping else { return }
        buffer.append(data)
        while let end = buffer.firstIndex(of: 10) {
            let line = buffer.prefix(upTo: end)
            buffer.removeSubrange(...end)
            guard let event = try? JSONSerialization.jsonObject(with: line) as? [String: Any], let kind = event["event"] as? String else { continue }
            if let total = event["total_bytes"] as? Double, let completed = event["completed_bytes"] as? Double, total > 0 {
                progress = completed / total
                bytes = "\(ByteCountFormatter.string(fromByteCount: Int64(completed), countStyle: .file)) / \(ByteCountFormatter.string(fromByteCount: Int64(total), countStyle: .file))"
            }
            switch kind {
            case "setup": status = "Preparing offline installation…"
            case "downloading": status = "Downloading assets…"; detail = event["path"] as? String ?? ""
            case "verifying": status = "Verifying assets…"; detail = event["path"] as? String ?? ""
            case "verified": status = "Starting local service…"
            case "ready":
                ready = true; busy = false; status = "Dance2Music is ready."
                detail = "Keep Dance2Music running while you use Chrome. Setup is complete; internet is no longer required."
                if !opened { opened = true; openChrome() }
            case "error":
                sawError = true; busy = false; ready = false
                status = event["message"] as? String ?? "Setup failed. Choose Retry."
                detail = "Verified downloads are kept. Logs: ~/Library/Logs/Dance2Music/"
            default: break
            }
        }
    }

    func openChrome() {
        guard ready, let chrome else { return }
        let config = NSWorkspace.OpenConfiguration()
        NSWorkspace.shared.open([URL(string: "http://127.0.0.1:5092/live/")!], withApplicationAt: chrome, configuration: config) { _, error in
            if let error { Task { @MainActor in self.status = "Chrome could not open: \(error.localizedDescription). Choose Open in Chrome to retry." } }
        }
    }

    func retry() {
        guard !busy else { return }
        busy = true; ready = false
        stop { [self] in
            pipe?.fileHandleForReading.readabilityHandler = nil; pipe = nil
            try? log?.close(); log = nil; process = nil
            start(repair: true)
        }
    }

    func stop(completion: @escaping () -> Void) {
        stopping = true
        guard let task = process, task.isRunning else { DispatchQueue.main.async { completion() }; return }
        task.terminate()
        // Backend owns a new process group. Only signal it while our child is
        // still alive, avoiding reused PID/process-group identifiers.
        DispatchQueue.global().async {
            for _ in 0..<30 {
                if !task.isRunning { break }
                Thread.sleep(forTimeInterval: 0.1)
            }
            if task.isRunning {
                if getpgid(task.processIdentifier) == task.processIdentifier { kill(-task.processIdentifier, SIGKILL) }
                else { kill(task.processIdentifier, SIGKILL) }
            }
            DispatchQueue.main.async { completion() }
        }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    let launcher = Launcher()
    func applicationDidFinishLaunching(_ notification: Notification) {
        if let id = Bundle.main.bundleIdentifier,
           let other = NSRunningApplication.runningApplications(withBundleIdentifier: id).first(where: { $0.processIdentifier != ProcessInfo.processInfo.processIdentifier }) {
            other.activate(options: [.activateAllWindows]); NSApp.terminate(nil); return
        }
        launcher.start()
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { sender.windows.first?.makeKeyAndOrderFront(nil) }; return true
    }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        launcher.stop { sender.reply(toApplicationShouldTerminate: true) }
        return .terminateLater
    }
}

struct LauncherView: View {
    @ObservedObject var launcher: Launcher
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Dance2Music").font(.largeTitle.bold())
            Text(launcher.status).font(.headline).textSelection(.enabled)
            Text(launcher.detail).foregroundStyle(.secondary).textSelection(.enabled)
            if launcher.busy { ProgressView(value: launcher.progress); Text(launcher.bytes).monospacedDigit() }
            if launcher.needsChrome { Link("Install Google Chrome", destination: URL(string: "https://www.google.com/chrome/")!) }
            HStack {
                Button("Retry") { launcher.retry() }.disabled(launcher.busy)
                Button("Open in Chrome") { launcher.openChrome() }.disabled(!launcher.ready)
                Spacer()
                Button("Quit") { NSApp.terminate(nil) }.keyboardShortcut("q")
            }
            Text("Closing this window keeps the service running. Quit stops downloads and the local service.").font(.caption).foregroundStyle(.secondary)
        }.padding(28).frame(width: 510)
    }
}

@main
struct Dance2MusicApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate
    var body: some Scene {
        Window("Dance2Music", id: "launcher") { LauncherView(launcher: delegate.launcher) }
            .windowResizability(.contentSize)
    }
}
