import type { LoadReport } from "./run-load.ts"
import type { LatencySummary } from "./stats.ts"

export function formatReport(report: LoadReport): string {
  const lines = [
    `viewers            ${report.viewers} at ${report.requestedRate}/s requested`,
    `started per second ${report.startedPerSecond.toFixed(0)}`,
    `answered per second ${report.answeredPerSecond.toFixed(0)}`,
    `sign-in latency    ${latency(report.signIn)}`,
    `callback latency   ${latency(report.callback)}`,
    `queued, to final   ${latency(report.queued)}`,
    `callback outcomes  ${counts(report.callbackOutcomes)}`,
    `final outcomes     ${counts(report.finalOutcomes)}`,
    `429 answered       ${report.rateLimited}`,
    `poll errors        ${report.pollErrors}`,
    `repeat sign-ins    ${report.repeatAttempts}`,
    `entrant count      ${report.entrantCount} (accepted viewers ${report.acceptedViewers})`,
    `duplicate logins   ${report.duplicateLogins}`,
    `entered twice      ${report.enteredTwice}`,
    `queue counters     ${JSON.stringify(report.queueStats)}`,
    report.failures.length === 0
      ? "PASS"
      : ["FAIL", ...report.failures.map((failure) => `  - ${failure}`)].join("\n"),
  ]
  return lines.join("\n")
}

function latency(summary: LatencySummary): string {
  if (summary.count === 0) return "none"
  return `p50 ${summary.p50.toFixed(0)} ms, p95 ${summary.p95.toFixed(0)} ms, p99 ${summary.p99.toFixed(0)} ms, max ${summary.max.toFixed(0)} ms (n=${summary.count})`
}

function counts(record: Readonly<Record<string, number>>): string {
  return (
    Object.entries(record)
      .map(([name, count]) => `${name}=${count}`)
      .join(", ") || "none"
  )
}
