import { code39Shape, sanitizeBarcodeValue } from '@/lib/barcode';

// Prints a scannable Code 39 barcode. The bars are drawn as a plain SVG so they stay
// crisp on paper, and the encoded value is repeated underneath for anyone typing it in
// by hand.
export function FeeBarcode({ value, caption, height = 62, module = 2 }: {
  value: string;
  caption?: string;
  height?: number;
  module?: number;
}) {
  const shape = code39Shape(value, module, height);
  const label = sanitizeBarcodeValue(value);

  return (
    <div className="fee-barcode">
      <svg
        className="fee-barcode-svg"
        role="img"
        aria-label={`Barcode ${label}`}
        viewBox={`0 0 ${shape.width} ${shape.height}`}
        preserveAspectRatio="none"
        style={{ height: `${shape.height}px` }}
      >
        <rect x="0" y="0" width={shape.width} height={shape.height} fill="#ffffff" />
        {shape.bars.map((bar) => (
          <rect key={`${bar.x}-${bar.width}`} x={bar.x} y="0" width={bar.width} height={shape.height} fill="#111111" />
        ))}
      </svg>
      <span className="fee-barcode-value">{label}</span>
      {caption && <small className="fee-barcode-caption">{caption}</small>}
    </div>
  );
}
