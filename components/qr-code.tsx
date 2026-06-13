import QRCode from "qrcode";

import { cn } from "@/lib/utils";

/**
 * Server-rendered QR code (no client JS). Encodes `value` into a data-URL
 * image at request time. Black modules on a pale-gold field for contrast.
 */
export async function QrCode({
  value,
  size = 220,
  className,
}: {
  value: string;
  size?: number;
  className?: string;
}) {
  const dataUrl = await QRCode.toDataURL(value, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: size,
    color: { dark: "#080806", light: "#f4e6b4" },
  });

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={dataUrl}
      alt={`QR code for ${value}`}
      width={size}
      height={size}
      className={cn("block", className)}
    />
  );
}
