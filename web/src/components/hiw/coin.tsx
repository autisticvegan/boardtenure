// The site's mark: a coin that keeps landing. Decorative; the headline says the same thing in words.
export function Coin({ size = 112 }: { size?: number }) {
  return (
    <div aria-hidden className="hiw-coin shrink-0" style={{ ["--coin" as string]: `${size}px` }}>
      <div className="hiw-coin-inner">
        <div className="hiw-face" style={{ fontSize: size * 0.42 }}>$</div>
        <div className="hiw-face tails" style={{ fontSize: size * 0.3 }}>you</div>
      </div>
    </div>
  );
}
