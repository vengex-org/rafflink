import { useMemo } from "react"
import { encode } from "uqr"

/** Modules of white around the code that scanners need to find its edges. */
const quietZone = 4

/** `value` as a QR code: one rect per dark module, colored by the stylesheet, so a strict CSP needs nothing extra. */
export function QrCode({ value, label }: { readonly value: string; readonly label: string }) {
  const { data, size } = useMemo(() => encode(value, { ecc: "M", border: quietZone }), [value])
  return (
    <svg
      className="qr"
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
    >
      {data.flatMap((row, y) =>
        row.map((dark, x) =>
          dark ? <rect key={`${x},${y}`} x={x} y={y} width={1} height={1} /> : null,
        ),
      )}
    </svg>
  )
}
