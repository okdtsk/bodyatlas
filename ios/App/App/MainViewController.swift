import UIKit
import Capacitor

/// App entry view controller (wired in Main.storyboard).
///
/// App-target plugins are NOT auto-discovered: the bridge only reads the
/// top-level `packageClassList` of the bundled capacitor.config.json, and the
/// Capacitor CLI regenerates that key on every `cap sync` from npm plugin
/// packages only (see @capacitor/cli util/iosplugin.js). Registering here via
/// `capacitorDidLoad()` is the documented, sync-proof mechanism.
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginType(HealthSyncPlugin.self)
    }
}
