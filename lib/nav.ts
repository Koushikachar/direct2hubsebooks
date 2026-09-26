// Which top-nav link is "current" for a given URL path. Kept in its own file
// so the rules are easy to test and identical for the desktop bar and the
// mobile menu.
//
// Rules: trailing slashes are ignored ("/about/" is "/about"); "/index" and
// "/home" count as the home page; "/" only matches the home page itself; any
// other link matches its own page and pages beneath it ("/price/x"), but NOT a
// look-alike prefix ("/pricelist" must not light up "Price").
export function isNavActive(pathname: string | null | undefined, href: string): boolean {
  if (!pathname) return false;
  let path = pathname.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  if (path === "/index" || path === "/home") path = "/";
  if (href === "/") return path === "/";
  return path === href || path.startsWith(`${href}/`);
}
