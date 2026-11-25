/* Tuna Tuna tip jar
   Paste your personal payment link below. PayPal.me and Ko-fi both work.
   Leave the empty string until the link is ready — the app then shows
   "The tip link is coming soon." instead of a broken button.

   Tips are optional, go directly to the creator, and unlock nothing.
   This is a peer-to-peer payment. Do not route it through Google Play Billing.

   Examples (uncomment one and replace the path):
     root.TIP_JAR_URL = "https://paypal.me/yourname";
     root.TIP_JAR_URL = "https://ko-fi.com/yourname";

   After you change this file on a site that is already installed, bump CACHE
   in sw.js so the service worker drops the previous copy.
*/
(function (root) {
  root.TIP_JAR_URL = "https://ko-fi.com/tunatunaapp";
})(typeof globalThis !== 'undefined' ? globalThis : this);
