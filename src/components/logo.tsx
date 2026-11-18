import Link from "next/link";

export function Logo({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="group inline-flex items-center gap-2" aria-label="LendLoop home">
      <svg viewBox="0 0 32 32" className="size-7 text-brand transition-transform duration-500 group-hover:rotate-180" aria-hidden>
        <circle cx="12" cy="16" r="7.5" fill="none" stroke="currentColor" strokeWidth="3" />
        <circle cx="20" cy="16" r="7.5" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.55" />
      </svg>
      <span className="font-display text-xl tracking-tight">LendLoop</span>
    </Link>
  );
}
