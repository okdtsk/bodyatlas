import Foundation
import Capacitor
import HealthKit

@objc(HealthSyncPlugin)
public class HealthSyncPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HealthSyncPlugin"
    public let jsName = "HealthSync"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "querySamples", returnType: CAPPluginReturnPromise)
    ]

    private let healthStore = HKHealthStore()

    private var readTypes: Set<HKObjectType> {
        var types = Set<HKObjectType>()
        if let sleepType = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) {
            types.insert(sleepType)
        }
        if let bodyMassType = HKObjectType.quantityType(forIdentifier: .bodyMass) {
            types.insert(bodyMassType)
        }
        if let bodyFatType = HKObjectType.quantityType(forIdentifier: .bodyFatPercentage) {
            types.insert(bodyFatType)
        }
        return types
    }

    @objc func requestAuthorization(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("HealthKit is not available on this device")
            return
        }
        healthStore.requestAuthorization(toShare: nil, read: readTypes) { _, error in
            if let error = error {
                call.reject("Authorization failed: \(error.localizedDescription)")
                return
            }
            // HealthKit does not reveal per-type grant status for reads.
            // Resolve once the prompt completes regardless of user choices.
            call.resolve(["granted": true])
        }
    }

    @objc func querySamples(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("HealthKit is not available on this device")
            return
        }

        let days = max(1, min(90, call.getInt("days") ?? 30))
        let now = Date()
        guard let startDate = Calendar.current.date(byAdding: .day, value: -days, to: now) else {
            call.reject("Failed to compute start date")
            return
        }
        let predicate = HKQuery.predicateForSamples(withStart: startDate, end: now, options: .strictStartDate)

        let isoFormatter = ISO8601DateFormatter()
        isoFormatter.timeZone = TimeZone(identifier: "UTC")!
        isoFormatter.formatOptions = [.withInternetDateTime]

        let group = DispatchGroup()
        var sleepResults: [[String: Any]] = []
        var weightResults: [[String: Any]] = []
        var bodyFatResults: [[String: Any]] = []
        var queryError: String?

        // Sleep query
        if let sleepType = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) {
            group.enter()
            let sleepQuery = HKSampleQuery(sampleType: sleepType, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, samples, error in
                defer { group.leave() }
                if let error = error {
                    queryError = "Sleep query failed: \(error.localizedDescription)"
                    return
                }
                guard let samples = samples as? [HKCategorySample] else { return }
                for sample in samples {
                    let value: String?
                    switch HKCategoryValueSleepAnalysis(rawValue: sample.value) {
                    case .asleepUnspecified, .asleepCore, .asleepDeep, .asleepREM:
                        value = "asleep"
                    case .inBed:
                        value = "inBed"
                    case .awake:
                        value = nil
                    default:
                        value = nil
                    }
                    guard let v = value else { continue }
                    sleepResults.append([
                        "start": isoFormatter.string(from: sample.startDate),
                        "end": isoFormatter.string(from: sample.endDate),
                        "value": v
                    ])
                }
            }
            healthStore.execute(sleepQuery)
        }

        // Weight query
        if let bodyMassType = HKObjectType.quantityType(forIdentifier: .bodyMass) {
            group.enter()
            let weightQuery = HKSampleQuery(sampleType: bodyMassType, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, samples, error in
                defer { group.leave() }
                if let error = error {
                    queryError = "Weight query failed: \(error.localizedDescription)"
                    return
                }
                guard let samples = samples as? [HKQuantitySample] else { return }
                let kgUnit = HKUnit.gramUnit(with: .kilo)
                for sample in samples {
                    weightResults.append([
                        "date": isoFormatter.string(from: sample.startDate),
                        "kg": sample.quantity.doubleValue(for: kgUnit)
                    ])
                }
            }
            healthStore.execute(weightQuery)
        }

        // Body fat query
        if let bodyFatType = HKObjectType.quantityType(forIdentifier: .bodyFatPercentage) {
            group.enter()
            let bodyFatQuery = HKSampleQuery(sampleType: bodyFatType, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, samples, error in
                defer { group.leave() }
                if let error = error {
                    queryError = "Body fat query failed: \(error.localizedDescription)"
                    return
                }
                guard let samples = samples as? [HKQuantitySample] else { return }
                let percentUnit = HKUnit.percent()
                for sample in samples {
                    bodyFatResults.append([
                        "date": isoFormatter.string(from: sample.startDate),
                        "pct": sample.quantity.doubleValue(for: percentUnit) * 100.0
                    ])
                }
            }
            healthStore.execute(bodyFatQuery)
        }

        group.notify(queue: .main) {
            if let error = queryError {
                call.reject(error)
                return
            }
            call.resolve([
                "sleep": sleepResults,
                "weight": weightResults,
                "bodyFat": bodyFatResults
            ])
        }
    }
}
