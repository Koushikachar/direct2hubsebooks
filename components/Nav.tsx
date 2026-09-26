"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FiMenu, FiX } from "react-icons/fi";
import ThemeToggle from "./ThemeToggle";
import { isNavActive } from "@/lib/nav";

interface NavProps {
  logoUrl?: string;
  name?: string;
  /**
   * The path of the page this Nav sits on ("/", "/about", …). Every page
   * passes its own — the server knows exactly which page it is rendering, so
   * the highlighted link is already correct in the raw HTML (no JavaScript
   * needed, no flash). See the note on `pathname` below for why this matters.
   */
  current?: string;
}

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
  { href: "/price", label: "Price" },
];

export default function Nav({
  logoUrl = "/uploads/logo-placeholder.png",
  name = "Direct2hub",
  current,
}: NavProps) {
  const routerPathname = usePathname();

  // WHY the highlight used to vanish after a page refresh on Vercel:
  // pages are pre-rendered (static / ISR) and usePathname() has no value while
  // that happens, so the HTML that reaches the browser has NO link
  // highlighted. On a hard refresh React then hydrates that HTML with the real
  // path — and React does not repair a mismatched `class`/`aria-current`
  // attribute during hydration, so the wrong (un-highlighted) markup simply
  // stayed. Clicking around inside the app worked, because that never goes
  // through hydration — hence "works the first time, breaks after refresh".
  //
  // The fix has two parts:
  //  1. Each page tells Nav its own path (`current`), so the server HTML is
  //     right from the start and hydration has nothing to disagree about.
  //  2. For a page that doesn't (terms, privacy …), the path is read AFTER the
  //     first render, in an effect. That is an ordinary state update, which
  //     React always applies to the DOM — and the first client render matches
  //     the server HTML exactly.
  const [clientPath, setClientPath] = useState<string | null>(null);
  useEffect(() => {
    setClientPath(routerPathname ?? window.location.pathname);
  }, [routerPathname]);
  const pathname = current ?? clientPath;
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Clicking the link for the page you are already on does nothing in
  // Next.js by default, which feels like a dead button. Scroll back to the
  // top instead (what people expect from "Home").
  function handleSamePageClick(e: React.MouseEvent, isCurrent: boolean) {
    if (!isCurrent || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  }

  return (
    <>
      <header className="glass-header sticky top-0 z-50 text-brick-950 dark:text-cream">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <Link
            href="/"
            className="flex items-center gap-3"
            onClick={(e) => {
              setOpen(false);
              handleSamePageClick(e, isNavActive(pathname, "/"));
            }}
          >
            <div className="relative h-9 w-9 overflow-hidden rounded-full ring-2 ring-ember-500/25 sm:h-10 sm:w-10">
              <Image
                src={logoUrl}
                alt={`${name} logo`}
                fill
                sizes="40px"
                className="object-cover"
                priority
              />
            </div>
            <span className="font-display text-base font-bold tracking-tight sm:text-lg">
              {name}
            </span>
          </Link>

          <nav className="hidden items-center gap-1 sm:flex">
            {LINKS.map((link) => {
              const active = isNavActive(pathname, link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  onClick={(e) => handleSamePageClick(e, active)}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    active
                      ? "bg-ember-600 text-white shadow-sm"
                      : "text-brick-800 hover:bg-ember-600/10 dark:text-cream/80 dark:hover:bg-white/10"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
            <div className="ml-2 pl-2">
              <ThemeToggle />
            </div>
          </nav>

          <div className="flex items-center gap-2 sm:hidden">
            <ThemeToggle />
            <button
              type="button"
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className="grid h-9 w-9 place-items-center rounded-lg border border-black/10 dark:border-white/15"
            >
              {open ? <FiX /> : <FiMenu />}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile menu overlay — sibling of <header>, NOT nested inside it,
          so `position: fixed` is relative to the viewport, not the sticky header */}
      <div
        ref={menuRef}
        onClick={() => setOpen(false)}
        style={{
          position: "fixed",
          inset: 0,
          top: "60px",
          zIndex: 40,
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 300ms ease-out",
        }}
        className="sm:hidden"
      >
        {/* dark, blurred backdrop over the page content behind the menu */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(0,0,0,0.62)",
            backdropFilter: "blur(18px)",
            WebkitBackdropFilter: "blur(18px)",
          }}
        />

        {/* liquid-glass panel */}
        <div
          onClick={(e) => e.stopPropagation()}
          className="glass-mobile-menu"
          style={{
            position: "relative",
            isolation: "isolate",
            margin: "12px",
            borderRadius: "24px",
            border: "1px solid rgba(255,255,255,0.25)",
            boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
            backdropFilter: "blur(45px) saturate(160%)",
            WebkitBackdropFilter: "blur(45px) saturate(160%)",
            padding: "12px",
            transform: open
              ? "translateY(0) scale(1)"
              : "translateY(-12px) scale(0.95)",
            opacity: open ? 1 : 0,
            transition: "all 300ms ease-out",
          }}
        >
          <nav className="flex flex-col gap-1">
            {LINKS.map((link) => {
              const active = isNavActive(pathname, link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  onClick={(e) => {
                    setOpen(false);
                    handleSamePageClick(e, active);
                  }}
                  className={`rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                    active
                      ? "bg-ember-600 text-white"
                      : "text-brick-800 hover:bg-black/5 dark:text-cream/90 dark:hover:bg-white/10"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>
    </>
  );
}
