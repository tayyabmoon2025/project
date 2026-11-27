import { QRCodeSVG } from 'qrcode.react';
import { ShieldCheck } from 'lucide-react';

// The verification code printed at the foot of a certificate. It carries the address of
// the school's verification page together with this certificate's number and code, so a
// scanner opens the answer directly. It is drawn as an SVG, which stays sharp at any
// print size and needs no image file or network request.
export function CertificateQrCode({ url, number, code, size = 84 }: {
  url: string;
  number: string | null;
  code: string | null;
  size?: number;
}) {
  if (!url) return null;

  return (
    <div className="cert-qr">
      <QRCodeSVG
        value={url}
        size={size}
        level="M"
        marginSize={1}
        bgColor="#ffffff"
        fgColor="#16232d"
        title={`Verify certificate ${number ?? ''}`}
      />
      <div className="cert-qr-copy">
        <strong><ShieldCheck size={12} /> Verify this certificate</strong>
        <span>Scan the code to confirm this certificate on the school record</span>
        <span className="cert-qr-keys">
          <b>{number ?? '—'}</b>
          <i>code {code ?? '—'}</i>
        </span>
      </div>
    </div>
  );
}
