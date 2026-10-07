import Image from 'next/image';
import Link from 'next/link';

type BrandLockupProps = {
  className?: string;
  imageSize?: number;
};

export function BrandLockup({ className = '', imageSize = 44 }: BrandLockupProps) {
  return (
    <Link href="/" className={`brand-lockup ${className}`} aria-label="IHURIRO RY'AMATA, Milk System home">
      <Image src="/brand-logo.png" width={1254} height={1254} sizes={`${imageSize}px`} priority className="brand-lockup-image" alt="" aria-hidden="true" />
      <span className="brand-lockup-copy">
        <strong>IHURIRO RY'AMATA</strong>
        <small>Milk System</small>
      </span>
    </Link>
  );
}