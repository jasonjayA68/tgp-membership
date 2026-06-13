import { cn } from "@/lib/utils";

/**
 * Inline-SVG rendition of the Tau Gamma Phi seal — the fallback shown when the
 * official logo image (/public/tgp-seal.png) is not present.
 */
function SealMark({ className }: { className?: string }) {
  const gold = "#f5c518";
  const black = "#0a0a0a";

  return (
    <svg
      viewBox="0 0 200 200"
      aria-hidden="true"
      className={cn("select-none", className)}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <path id="tgp-arc-top" fill="none" d="M 19 100 A 81 81 0 0 1 181 100" />
        <path id="tgp-arc-bottom" fill="none" d="M 21 100 A 79 79 0 0 0 179 100" />
      </defs>

      {/* Rings: thin black edge → wide gold band → inner black disc */}
      <circle cx="100" cy="100" r="100" fill={black} />
      <circle cx="100" cy="100" r="98" fill={gold} />
      <circle cx="100" cy="100" r="71" fill={black} />

      {/* Circular mottos (black on gold) */}
      <g fill={black} fontFamily="Cinzel, Georgia, serif" fontWeight={700}>
        <text fontSize="13.5" style={{ letterSpacing: "2px" }}>
          <textPath href="#tgp-arc-top" startOffset="50%" textAnchor="middle">
            TAU GAMMA PHI
          </textPath>
        </text>
        <text fontSize="9" style={{ letterSpacing: "1.1px" }}>
          <textPath
            href="#tgp-arc-bottom"
            startOffset="50%"
            textAnchor="middle"
          >
            FORTIS VOLUNTAS FRATERNITAS
          </textPath>
        </text>
      </g>

      {/* Founding year */}
      <g
        fill={black}
        fontFamily="Cinzel, Georgia, serif"
        fontWeight={800}
        fontSize="14"
        textAnchor="middle"
      >
        <text x="22" y="106">
          19
        </text>
        <text x="178" y="106">
          68
        </text>
      </g>

      {/* Central triskelion emblem */}
      <g
        stroke={gold}
        strokeWidth="3.4"
        strokeLinejoin="round"
        strokeLinecap="round"
        fill="none"
      >
        <path d="M 66 60 L 134 60 L 114 130 L 86 130 Z" />
        <path d="M 72 53 L 143 53 L 134 60" />
        <path d="M 100 96 L 100 60" />
        <path d="M 100 96 L 126 117" />
        <path d="M 100 96 L 74 117" />
      </g>
      <g
        fill={gold}
        fontFamily="Cinzel, Georgia, serif"
        fontWeight={800}
        fontSize="20"
        textAnchor="middle"
      >
        <text x="82" y="93">
          Τ
        </text>
        <text x="120" y="85">
          Γ
        </text>
        <text x="100" y="123">
          Φ
        </text>
      </g>
    </svg>
  );
}

/**
 * Official Tau Gamma Phi seal.
 *
 * Layers the official logo from `/public/tgp-seal.png` (a transparent PNG) on
 * top of the inline-SVG seal as a CSS `background-image`. When the PNG is
 * present it covers the SVG; when it is missing the background simply renders
 * nothing (CSS backgrounds never show a broken-image icon) and the SVG shows
 * through. This is fully server-rendered — no client JS or hydration needed.
 */
export function TgpSeal({
  className,
  title = "Tau Gamma Phi seal",
}: {
  className?: string;
  title?: string;
}) {
  return (
    <span
      role={title ? "img" : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      className={cn("relative inline-block overflow-hidden align-middle", className)}
    >
      {/* SVG fallback, slightly inset so it can never peek past the PNG seal. */}
      <SealMark className="absolute inset-[7%]" />
      <span
        aria-hidden="true"
        className="absolute inset-0 bg-contain bg-center bg-no-repeat"
        style={{ backgroundImage: "url('/tgp-seal.png')" }}
      />
    </span>
  );
}
