/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * Origins allowed to reach the dev server's internal endpoints (HMR, dev assets).
   *
   * Next blocks cross-origin dev requests by default, which means loading the app on a phone via
   * the machine's LAN address gets a working page but broken hot reload and dev tooling. Listing
   * the private ranges here is what makes on-device testing usable — the sketch tool's touch
   * behaviour can only really be judged on a real phone.
   *
   * DEV ONLY. This has no effect on a production build, and deliberately covers private RFC1918
   * ranges rather than the whole internet.
   */
  allowedDevOrigins: ["192.168.1.*", "10.*", "172.16.*", "*.local"],
};

export default nextConfig;
