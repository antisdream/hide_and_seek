package com.antisdream.nunsum;

import android.annotation.SuppressLint;
import android.annotation.TargetApi;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Insets;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.DisplayCutout;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import java.io.ByteArrayInputStream;
import java.util.Collections;

/** PC에서 실행하는 눈숨 게임을 USB 연결로 여는 테스트 전용 WebView 앱. */
public final class MainActivity extends Activity {
    private static final String GAME_URL = "http://localhost:3100/";
    private FrameLayout root;
    private WebView webView;
    private LinearLayout offlinePanel;
    private String retryUrl = GAME_URL;
    private boolean mainFrameFailed;
    private BackApi33 backHandler;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        root = new FrameLayout(this);
        root.setBackgroundColor(getColor(R.color.navy));
        setContentView(root);
        applySystemInsets();
        createWebView();
        createOfflinePanel();
        if (Build.VERSION.SDK_INT >= 33) backHandler = new BackApi33(this);
        webView.loadUrl(GAME_URL);
    }

    @SuppressWarnings("deprecation")
    private void applySystemInsets() {
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) controller.setSystemBarsAppearance(0,
                    WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                            | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
            getWindow().setStatusBarColor(Color.TRANSPARENT);
            getWindow().setNavigationBarColor(Color.TRANSPARENT);
        }
        root.setOnApplyWindowInsetsListener((view, windowInsets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                Insets bars = windowInsets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                Insets keyboard = windowInsets.getInsets(WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, keyboard.bottom));
                // 여백은 네이티브 root에서 한 번만 적용해 WebView의 CSS 여백과 중복하지 않는다.
                return WindowInsets.CONSUMED;
            }
            int left = windowInsets.getSystemWindowInsetLeft();
            int top = windowInsets.getSystemWindowInsetTop();
            int right = windowInsets.getSystemWindowInsetRight();
            int bottom = windowInsets.getSystemWindowInsetBottom();
            if (Build.VERSION.SDK_INT >= 28) {
                DisplayCutout cutout = windowInsets.getDisplayCutout();
                if (cutout != null) {
                    left = Math.max(left, cutout.getSafeInsetLeft());
                    top = Math.max(top, cutout.getSafeInsetTop());
                    right = Math.max(right, cutout.getSafeInsetRight());
                    bottom = Math.max(bottom, cutout.getSafeInsetBottom());
                }
            }
            view.setPadding(left, top, right, bottom);
            return windowInsets.consumeSystemWindowInsets();
        });
        root.requestApplyInsets();
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void createWebView() {
        webView = new WebView(this);
        webView.setBackgroundColor(getColor(R.color.navy));
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSafeBrowsingEnabled(true);
        // 새 창 링크도 같은 URL 허용 정책을 거쳐 외부 HTTPS는 브라우저로 전달한다.
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(false);
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (isTrustedPage(uri)) return false;
                if (request.isForMainFrame() && request.hasGesture()
                        && "https".equalsIgnoreCase(uri.getScheme()) && uri.getUserInfo() == null) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE));
                    } catch (ActivityNotFoundException ignored) {
                        Toast.makeText(MainActivity.this, R.string.browser_unavailable, Toast.LENGTH_SHORT).show();
                    }
                }
                return true;
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                // shouldOverrideUrlLoading을 거치지 않는 POST 등도 외부 페이지로 이 앱을 전환할 수 없다.
                if (request.isForMainFrame() && !isTrustedPage(request.getUrl())) {
                    return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden",
                            Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
                }
                return null;
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                if (!isTrustedPage(Uri.parse(url))) {
                    view.stopLoading();
                    showOffline();
                    return;
                }
                retryUrl = url;
                mainFrameFailed = false;
                offlinePanel.setVisibility(View.GONE);
                webView.setVisibility(View.VISIBLE);
            }

            @Override
            public void onPageCommitVisible(WebView view, String url) {
                if (!mainFrameFailed) offlinePanel.setVisibility(View.GONE);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showOffline();
            }

            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
                if (request.isForMainFrame()) showOffline();
            }
        });
        root.addView(webView, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
    }

    private static boolean isTrustedPage(Uri uri) {
        if (uri == null || !"http".equalsIgnoreCase(uri.getScheme()) || uri.getUserInfo() != null || uri.getPort() != 3100) return false;
        String host = uri.getHost();
        return "localhost".equalsIgnoreCase(host) || "127.0.0.1".equals(host);
    }

    private void createOfflinePanel() {
        offlinePanel = new LinearLayout(this);
        offlinePanel.setOrientation(LinearLayout.VERTICAL);
        offlinePanel.setGravity(Gravity.CENTER);
        offlinePanel.setPadding(dp(28), dp(28), dp(28), dp(28));
        offlinePanel.setBackgroundColor(getColor(R.color.navy));
        TextView title = new TextView(this);
        title.setText(R.string.offline_title);
        title.setTextColor(getColor(R.color.text_primary));
        title.setTextSize(24);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        title.setGravity(Gravity.CENTER);
        offlinePanel.addView(title);
        TextView message = new TextView(this);
        message.setText(R.string.offline_message);
        message.setTextColor(getColor(R.color.text_secondary));
        message.setTextSize(16);
        message.setGravity(Gravity.CENTER);
        message.setLineSpacing(dp(5), 1);
        LinearLayout.LayoutParams messageLayout = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        messageLayout.topMargin = dp(16);
        offlinePanel.addView(message, messageLayout);
        Button retry = new Button(this);
        retry.setText(R.string.retry);
        retry.setMinHeight(dp(48));
        LinearLayout.LayoutParams buttonLayout = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        buttonLayout.topMargin = dp(24);
        offlinePanel.addView(retry, buttonLayout);
        retry.setOnClickListener(view -> webView.loadUrl(retryUrl));
        offlinePanel.setVisibility(View.GONE);
        root.addView(offlinePanel, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
    }

    private void showOffline() {
        mainFrameFailed = true;
        webView.setVisibility(View.INVISIBLE);
        offlinePanel.setVisibility(View.VISIBLE);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void navigateBack() {
        if (webView.canGoBack()) webView.goBack();
        else finish();
    }

    @Override
    @SuppressWarnings("deprecation")
    // API 26–32 fallback. API 33+ uses BackApi33's native OnBackInvokedDispatcher registered in onCreate.
    @SuppressLint("GestureBackNavigation")
    public void onBackPressed() {
        navigateBack();
    }

    @Override
    public void onConfigurationChanged(Configuration configuration) {
        super.onConfigurationChanged(configuration);
        root.requestApplyInsets();
    }

    @Override
    protected void onPause() {
        webView.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onDestroy() {
        if (Build.VERSION.SDK_INT >= 33 && backHandler != null) backHandler.unregister(this);
        webView.stopLoading();
        root.removeView(webView);
        webView.destroy();
        super.onDestroy();
    }

    @TargetApi(33)
    private static final class BackApi33 {
        private final OnBackInvokedCallback callback;

        BackApi33(MainActivity activity) {
            callback = activity::navigateBack;
            activity.getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, callback);
        }

        void unregister(MainActivity activity) {
            activity.getOnBackInvokedDispatcher().unregisterOnBackInvokedCallback(callback);
        }
    }
}
