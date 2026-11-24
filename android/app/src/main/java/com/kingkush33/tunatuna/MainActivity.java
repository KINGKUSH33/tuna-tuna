package com.kingkush33.tunatuna;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Message;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

/**
 * Microphone prompts are answered here, after the in-app disclosure.
 * Optional tip links leave the WebView through a system view intent.
 */
public class MainActivity extends BridgeActivity {
    static final int REQ_RECORD_AUDIO = 44100;

    private PermissionRequest pendingWebPermission;
    private boolean micRequestInFlight;
    private boolean reportMicToPage;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);
        if (bridge == null || bridge.getWebView() == null) return;
        WebView webView = bridge.getWebView();
        webView.setWebChromeClient(new TunaChromeClient(bridge, this));
        webView.getSettings().setSupportMultipleWindows(true);
        webView.addJavascriptInterface(new TunaNative(this), "TunaNative");
    }

    void requestRecordAudio(PermissionRequest webRequest, boolean reportToPage) {
        if (webRequest != null) pendingWebPermission = webRequest;
        if (reportToPage) reportMicToPage = true;
        if (hasRecordAudio()) {
            finishRecordAudio(true);
            return;
        }
        if (micRequestInFlight) return;
        micRequestInFlight = true;
        ActivityCompat.requestPermissions(this, new String[] { Manifest.permission.RECORD_AUDIO }, REQ_RECORD_AUDIO);
    }

    private boolean hasRecordAudio() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    private void finishRecordAudio(boolean granted) {
        micRequestInFlight = false;
        PermissionRequest web = pendingWebPermission;
        pendingWebPermission = null;
        if (web != null) {
            if (granted) web.grant(new String[] { PermissionRequest.RESOURCE_AUDIO_CAPTURE });
            else web.deny();
        }
        if (reportMicToPage) {
            reportMicToPage = false;
            deliverMicResult(granted);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode == REQ_RECORD_AUDIO) {
            boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            finishRecordAudio(granted);
            return;
        }
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    }

    void openExternalUrl(String url) {
        Uri uri = parseHttpUrl(url);
        if (uri == null) return;
        runOnUiThread(() -> {
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, uri);
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(intent);
            } catch (Exception ignored) {
            }
        });
    }

    static Uri parseHttpUrl(String url) {
        if (url == null) return null;
        Uri uri;
        try {
            uri = Uri.parse(url.trim());
        } catch (Exception e) {
            return null;
        }
        String scheme = uri.getScheme();
        if (scheme == null) return null;
        if (!scheme.equalsIgnoreCase("https") && !scheme.equalsIgnoreCase("http")) return null;
        if (uri.getHost() == null || uri.getHost().isEmpty()) return null;
        return uri;
    }

    private void deliverMicResult(boolean granted) {
        if (bridge == null || bridge.getWebView() == null) return;
        WebView webView = bridge.getWebView();
        String js = "window.__tunaMicResult&&window.__tunaMicResult(" + (granted ? "true" : "false") + ")";
        webView.post(() -> webView.evaluateJavascript(js, null));
    }

    public static final class TunaNative {
        private final MainActivity activity;

        TunaNative(MainActivity activity) {
            this.activity = activity;
        }

        @JavascriptInterface
        public void ensureRecordAudio() {
            activity.runOnUiThread(() -> activity.requestRecordAudio(null, true));
        }

        @JavascriptInterface
        public void openExternal(String url) {
            activity.openExternalUrl(url);
        }
    }

    static final class TunaChromeClient extends BridgeWebChromeClient {
        private final MainActivity activity;

        TunaChromeClient(Bridge bridge, MainActivity activity) {
            super(bridge);
            this.activity = activity;
        }

        @Override
        public void onPermissionRequest(PermissionRequest request) {
            boolean audio = false;
            String[] resources = request.getResources();
            if (resources != null) {
                for (String resource : resources) {
                    if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) audio = true;
                }
            }
            if (!audio) {
                super.onPermissionRequest(request);
                return;
            }
            activity.requestRecordAudio(request, false);
        }

        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
            WebView probe = new WebView(view.getContext());
            probe.setWebViewClient(new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
                    activity.openExternalUrl(request.getUrl() == null ? null : request.getUrl().toString());
                    v.destroy();
                    return true;
                }
            });
            WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
            transport.setWebView(probe);
            resultMsg.sendToTarget();
            return true;
        }
    }
}
