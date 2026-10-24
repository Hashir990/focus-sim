package com.uswork.focussimulator;

import android.os.Bundle;
import android.webkit.WebView;

import androidx.activity.OnBackPressedCallback;

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
 *
 * <p><b>Why a dispatcher callback and not {@code onBackPressed()}.</b> That
 * override is what this class used to be, and on Android 16 it stopped being
 * called at all — Back left the app from every screen again, exactly as before
 * the class existed. Two things take the press first. Targeting SDK 36 turns
 * the predictive back API on, and {@code androidx}'s {@code ComponentActivity}
 * — which {@code BridgeActivity} sits on — registers its own
 * {@code OnBackPressedDispatcher} with the system to receive it. With no
 * callback added to that dispatcher it runs its fallback, and the fallback is
 * {@code Activity.super.onBackPressed()}: the framework's, not this class's.
 * The override was dead code on any device new enough to route back that way.
 *
 * <p>Adding a callback to the dispatcher is the one place that gets the press
 * on every version, because androidx feeds it both the predictive callback and
 * the legacy one. The manifest opt-out was tried first and is not a fix: it is
 * ignored for apps targeting SDK 36, and on the versions where it is honoured
 * the press still arrives here.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        /* Enabled for good. There is no screen where finishing the activity is
           what should happen — the page either closes a layer or asks to be
           backgrounded — so there is nothing for the callback to stand down
           for. */
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView web = (getBridge() != null) ? getBridge().getWebView() : null;
                if (web == null) {
                    /* Before the bridge exists there is no page to ask, and a
                       press that does nothing at all is worse than leaving. */
                    finish();
                    return;
                }
                /* No goBack() here: that would close a layer on this side and
                   let the page close another from the popstate, so a single
                   press would take two screens off. */
                web.evaluateJavascript("window.__androidBack && window.__androidBack()", null);
            }
        });
    }
}
