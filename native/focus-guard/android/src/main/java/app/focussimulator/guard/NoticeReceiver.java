package app.focussimulator.guard;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import org.json.JSONObject;

/**
 * Where the notification's buttons land, and where the end-of-block alarm rings.
 *
 * <p><b>This runs when nothing else is left.</b> A broadcast receiver is started
 * for the delivery whether or not the app's process still exists, which is the
 * point: pressing Pause an hour after the web view was frozen has to do
 * something, and the only thing that can be relied upon here is the mirror in
 * {@link GuardStore}.
 *
 * <p>So a button does two things. It applies the command to the mirror, so the
 * notification is redrawn correctly at once and the state survives; and it
 * writes the command down for the web app to apply to the real clock whenever it
 * next runs. If the app <i>is</i> alive, the plugin also hears about it
 * immediately and applies it there and then, which is the only difference
 * between a live app and a dead one from the outside.
 */
public class NoticeReceiver extends BroadcastReceiver {

    public static final String ACT_CMD = "app.focussimulator.guard.CMD";
    public static final String ACT_DONE = "app.focussimulator.guard.DONE";

    @Override
    public void onReceive(Context c, Intent intent) {
        String act = intent == null ? null : intent.getAction();
        if (ACT_DONE.equals(act)) { finished(c); return; }
        if (!ACT_CMD.equals(act)) return;

        String cmd = intent.getStringExtra("cmd");
        if (cmd == null) return;
        long now = System.currentTimeMillis();

        JSONObject t = GuardStore.timer(c);
        try {
            if ("pause".equals(cmd)) {
                /* The remainder is worked out here rather than trusted from the
                   mirror, because the mirror's remainingMs is only right at the
                   moment it was written. endAt is the fact; everything else is a
                   snapshot of it. Same reasoning as pause() in the web app's
                   timer engine, and the same trap. */
                t.put("running", false);
                t.put("remainingMs", Math.max(0, t.optLong("endAt", now) - now));
            } else if ("resume".equals(cmd)) {
                t.put("running", true);
                t.put("endAt", now + t.optLong("remainingMs", 0));
            } else if ("stop".equals(cmd)) {
                t.put("live", false);
                t.put("running", false);
            } else {
                return;
            }
        } catch (Exception ignored) { return; }

        GuardStore.setTimer(c, t);
        GuardStore.pushCommand(c, cmd, now);
        /* Still in the background - that is where the button was pressed - so the
           ongoing notice stays up unless the block itself is over. */
        TimerNotice.sync(c, t.optBoolean("live", false));
        GuardStore.setNoticeUp(c, t.optBoolean("live", false));
        FocusGuardPlugin.emit(cmd, now);
    }

    /** The block ran out while nobody was looking. */
    private void finished(Context c) {
        JSONObject t = GuardStore.timer(c);
        if (!t.optBoolean("live", false)) return;
        boolean focus = "focus".equals(t.optString("mode", "focus"));
        /* The mirror is closed off rather than rolled into a break. The web app
           owns what happens next - the log, the embers, the cycle count, whether
           auto-continue starts the next one - and it will do all of that from the
           wall clock the moment it is looked at, exactly as it does after the
           phone has been in a pocket. Guessing here would mean two answers. */
        try {
            t.put("live", false);
            t.put("running", false);
            t.put("remainingMs", 0);
        } catch (Exception ignored) {}
        GuardStore.setTimer(c, t);
        GuardStore.setNoticeUp(c, false);
        TimerNotice.hide(c);
        TimerNotice.done(c, focus);
    }
}
