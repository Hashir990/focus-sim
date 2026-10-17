package com.uswork.focussimulator;

import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

/**
 * The app is one activity, and the only thing it adds to Capacitor's is Back.
 *
 * <p><b>Back was walking people out of a session.</b> This app is a single page
 * with layers stacked on it — a game over the shelf, a confirm over the game —
 * so as far as the WebView is concerned there is nowhere to go back *to*, and
 * the default behaviour is to finish the activity. One press from inside a
 * crossword and the block you were in the middle of was gone.
 *
 * <p>The web side has known what to close since it was written: {@code
 * BACK_LAYERS} in 44-back.js is the list of what sits on top of what, in order.
 * What was missing was anything telling it a press had happened. The browser
 * learns that from {@code popstate}; Android has to be asked.
 *
 * <p><b>So the press is forwarded and nothing is decided here.</b> Deciding on
 * this side would mean asking the page whether anything is open and waiting for
 * the answer, and {@code evaluateJavascript} is asynchronous — the activity
 * would have to finish or not finish on a callback, which is a race with
 * whatever the user does next. The page knows; the page answers; and when there
 * is nothing left to close it asks to be put in the background through the
 * plugin's {@code leave}. Backgrounded rather than finished, because a finished
 * activity is a cold start next time and a cold start loses the block.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onBackPressed() {
        WebView web = (getBridge() != null) ? getBridge().getWebView() : null;
        if (web == null) {
            super.onBackPressed();
            return;
        }
        /* No `super` call on this path, and no `goBack()` either: either one
           would close a layer here *and* let the page close another from the
           popstate, so a single press would take two screens off. */
        web.evaluateJavascript("window.__androidBack && window.__androidBack()", null);
    }
}
