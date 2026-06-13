import UIKit
import Capacitor

/// App entry view controller (wired in Main.storyboard).
///
/// App-target plugins are NOT auto-discovered: with `autoRegisterPlugins`
/// (the default) the bridge registers only the classes in the bundled
/// capacitor.config.json's top-level `packageClassList`, and the Capacitor CLI
/// only ever fills that from npm plugin packages. Crucially, under
/// `autoRegisterPlugins` `registerPluginType(_:)` is a no-op (it early-returns,
/// see CapacitorBridge.registerPluginType) — so the type-based call silently
/// registers nothing. `registerPluginInstance(_:)` is NOT gated: it registers
/// the instance by its jsName and exports the JS proxy. That is the sync-proof,
/// in-code mechanism for app-target plugins.
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(HealthSyncPlugin())
        bridge?.registerPluginInstance(NativeAuthPlugin())
    }
}
