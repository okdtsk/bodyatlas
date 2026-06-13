import Foundation
import UIKit
import Capacitor
import AuthenticationServices

/// Runs Google OAuth in ASWebAuthenticationSession (a system browser sheet),
/// because Google blocks OAuth inside embedded WebViews (403 disallowed_useragent).
/// The Worker's native callback redirects to com.okdtsk.bodyatlas://auth?code=...
/// which the session intercepts; the web side then exchanges the one-time code
/// for a session cookie via POST /auth/native/exchange.
@objc(NativeAuthPlugin)
public class NativeAuthPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    public let identifier = "NativeAuthPlugin"
    public let jsName = "NativeAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "signIn", returnType: CAPPluginReturnPromise)
    ]

    /// Strong reference: the session would deallocate (and silently cancel)
    /// without it, since start() does not retain the session.
    private var authSession: ASWebAuthenticationSession?

    @objc func signIn(_ call: CAPPluginCall) {
        guard let authURL = URL(string: "https://bodyatlas.okdtsk.dev/auth/google?native=1") else {
            call.reject("Invalid auth URL")
            return
        }

        let session = ASWebAuthenticationSession(
            url: authURL,
            callbackURLScheme: "com.okdtsk.bodyatlas"
        ) { [weak self] callbackURL, error in
            self?.authSession = nil

            if let error = error {
                if let sessionError = error as? ASWebAuthenticationSessionError,
                   sessionError.code == .canceledLogin {
                    call.reject("canceled")
                } else {
                    call.reject(error.localizedDescription)
                }
                return
            }

            guard
                let callbackURL = callbackURL,
                let components = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false),
                let code = components.queryItems?.first(where: { $0.name == "code" })?.value,
                !code.isEmpty
            else {
                call.reject("Missing code in callback URL")
                return
            }
            call.resolve(["code": code])
        }

        session.presentationContextProvider = self
        // Share the Safari cookie jar so an existing Google login is reusable.
        session.prefersEphemeralWebBrowserSession = false
        authSession = session

        // start() must run on the main thread (it presents UI).
        DispatchQueue.main.async {
            session.start()
        }
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let keyWindow = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow }
        return keyWindow ?? ASPresentationAnchor()
    }
}
