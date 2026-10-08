/**
 * Where people get Scrivn Scan.
 *
 * Until the Google Play listing is public there is only the direct download testers use
 * (/scan-download, the newest build in the scan-builds bucket). Set `SCAN_PLAY_URL` to the listing
 * the day it goes live and every "Get the app" button follows.
 */
export const SCAN_PLAY_URL: string | null = null;

export const SCAN_GET_HREF = SCAN_PLAY_URL ?? "/scan-download";

/** What the button says, true to where it goes. */
export const SCAN_GET_LABEL = SCAN_PLAY_URL ? "Get it on Google Play" : "Download for Android";
