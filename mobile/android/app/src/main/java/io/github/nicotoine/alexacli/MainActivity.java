package io.github.nicotoine.alexacli;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.webkit.WebView;
import androidx.core.content.FileProvider;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;
import java.io.File;
import java.util.Collections;
import org.json.JSONObject;

/**
 * The app, plus one thing the page cannot do on its own: hand a downloaded update to Android's installer.
 *
 * The page lives on the embedded server (http://127.0.0.1:3457), where Capacitor's own bridge is not injected (its
 * allowed origins are https only), so the page talks to this activity through a WebMessageListener named
 * "alexaUpdater", allowed for that one origin. The page never names a file: the only APK this installs is the one
 * the server downloaded and checked against the release's SHA256SUMS (interface/server/update.js), at a fixed path.
 * Android still asks the person to confirm the install; the first time, it also asks to allow installs from this app.
 */
public class MainActivity extends BridgeActivity {

    private static final String PAGE_ORIGIN = "http://127.0.0.1:3457";
    // Same place as ALEXA_CLI_UPDATE_DIR in src/main.cjs: capacitor-nodejs's data path is <files>/nodejs/data.
    private static final String APK_PATH = "nodejs/data/updates/alexa-cli-update.apk";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WebView webView = getBridge().getWebView();
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(webView, "alexaUpdater", Collections.singleton(PAGE_ORIGIN), this::onPageMessage);
        }
    }

    private void onPageMessage(WebView view, WebMessageCompat message, Uri sourceOrigin, boolean isMainFrame, JavaScriptReplyProxy reply) {
        if (!isMainFrame) return;
        String action;
        try {
            action = new JSONObject(String.valueOf(message.getData())).optString("action");
        } catch (Exception e) {
            return;
        }
        if ("canInstall".equals(action)) {
            answer(reply, "allowed", canInstall() ? "yes" : "no");
        } else if ("install".equals(action)) {
            answer(reply, "status", install());
        }
    }

    private boolean canInstall() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getPackageManager().canRequestPackageInstalls();
    }

    /** "started", "needs-permission" (Android's settings page was opened) or "missing" (no downloaded APK). */
    private String install() {
        File apk = new File(getFilesDir(), APK_PATH);
        if (!apk.isFile()) return "missing";
        if (!canInstall()) {
            startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName())));
            return "needs-permission";
        }
        Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", apk);
        Intent intent = new Intent(Intent.ACTION_VIEW)
            .setDataAndType(uri, "application/vnd.android.package-archive")
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(intent);
        return "started";
    }

    private void answer(JavaScriptReplyProxy reply, String key, String value) {
        try {
            reply.postMessage(new JSONObject().put(key, value).toString());
        } catch (Exception ignored) {
            // The page went away meanwhile: nobody to tell.
        }
    }
}
